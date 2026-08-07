import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { computeStaffPay, allowedLeaves, deductionPerFlatDay } from "@/lib/staff";
import { syncStaffPayroll } from "@/lib/google-sheets";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

// Prefill a staff member's month: the marked absent days + note.
export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staffId");
  const month = searchParams.get("month");
  if (!staffId || !month?.match(/^\d{4}-\d{2}$/)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const row = await prisma.staffMonth.findUnique({
    where: { staffId_month: { staffId, month } },
    select: { absentByDay: true, note: true },
  });
  return NextResponse.json({ absentByDay: row?.absentByDay ?? {}, note: row?.note ?? "" });
}

const schema = z.object({
  staffId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // Map of day-of-month (1..31) → the listing IDs (flats) missed that day.
  absentByDay: z.record(z.string(), z.array(z.string())).default({}),
  note: z.string().trim().max(300).optional(),
});

// Save a staff member's monthly attendance, computing pay from their salary and
// their allowed leaves. Absences are counted in FLAT-DAYS: each flat missed on a
// day counts as one.
export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { staffId, month, note } = parsed.data;

  const [staff, settings, listings] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, monthlySalary: true, allowedLeaves: true, numberOfFlats: true } }),
    getPlatformSettings(),
    prisma.listing.findMany({ select: { id: true } }),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  // Clean counts, compute pay from the staff's own salary, allowed leaves, and a
  // per-flat-day deduction DERIVED from their salary ÷ (flats × 30).
  const validIds = new Set(listings.map((l) => l.id));
  const absentByDay: Record<string, string[]> = {};
  let absences = 0;
  for (const [key, ids] of Object.entries(parsed.data.absentByDay)) {
    const day = Number(key);
    if (day < 1 || day > 31) continue;
    const clean = [...new Set(ids)].filter((id) => validIds.has(id));
    if (clean.length) {
      absentByDay[String(day)] = clean;
      absences += clean.length;
    }
  }
  const absentDays = Object.keys(absentByDay).map(Number).sort((a, b) => a - b);

  const monthlySalary = staff.monthlySalary ?? settings.staffMonthlySalary;
  const allowed = staff.allowedLeaves ?? allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const numberOfFlats = staff.numberOfFlats ?? settings.staffFlatsPerStaff;
  const deductionPerDay = deductionPerFlatDay(monthlySalary, numberOfFlats);
  const pay = computeStaffPay(monthlySalary, allowed, deductionPerDay, absences);

  const row = await prisma.staffMonth.upsert({
    where: { staffId_month: { staffId, month } },
    update: { absentByDay, absentDays, absences, monthlySalary, allowedLeaves: allowed, deductionPerDay, pay, note: note || null },
    create: { staffId, month, absentByDay, absentDays, absences, monthlySalary, allowedLeaves: allowed, deductionPerDay, pay, note: note || null },
  });

  after(async () => {
    await syncStaffPayroll({
      month,
      staffName: staff.name,
      absences,
      allowedLeaves: allowed,
      monthlySalary,
      deductionPerDay,
      pay,
      note: note || null,
    });
  });

  return NextResponse.json({ id: row.id, absences, allowedLeaves: allowed, pay });
}

// Delete a staff member's month: /api/admin/staff-month?id=...
export async function DELETE(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.staffMonth.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
