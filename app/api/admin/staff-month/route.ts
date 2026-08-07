import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { computeStaffPay, allowedLeaves } from "@/lib/staff";
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
    select: { absentDays: true, note: true },
  });
  return NextResponse.json({ absentDays: row?.absentDays ?? [], note: row?.note ?? "" });
}

const schema = z.object({
  staffId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  absentDays: z.array(z.coerce.number().int().min(1).max(31)).max(31),
  note: z.string().trim().max(300).optional(),
});

// Save a staff member's monthly attendance, computing pay from their salary and
// the allowed-leaves rule (leaves-per-flat × flats-per-staff).
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
  const absentDays = [...new Set(parsed.data.absentDays)].sort((a, b) => a - b);
  const absences = absentDays.length;

  const [staff, settings] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, monthlySalary: true } }),
    getPlatformSettings(),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const monthlySalary = staff.monthlySalary ?? settings.staffMonthlySalary;
  const allowed = allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const deductionPerDay = settings.staffDailyRate;
  const pay = computeStaffPay(monthlySalary, allowed, deductionPerDay, absences);

  const row = await prisma.staffMonth.upsert({
    where: { staffId_month: { staffId, month } },
    update: { absentDays, absences, monthlySalary, allowedLeaves: allowed, deductionPerDay, pay, note: note || null },
    create: { staffId, month, absentDays, absences, monthlySalary, allowedLeaves: allowed, deductionPerDay, pay, note: note || null },
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
