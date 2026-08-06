import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { computeStaffPay } from "@/lib/staff";
import { syncStaffPayroll } from "@/lib/google-sheets";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
}

// Prefill the calendar for a (staff, flat, month): returns the marked absent days.
export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staffId");
  const listingId = searchParams.get("listingId");
  const month = searchParams.get("month");
  if (!staffId || !listingId || !month?.match(/^\d{4}-\d{2}$/)) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const row = await prisma.staffPayroll.findUnique({
    where: { staffId_listingId_month: { staffId, listingId, month } },
    select: { absentDays: true, note: true },
  });
  return NextResponse.json({ absentDays: row?.absentDays ?? [], note: row?.note ?? "" });
}

const schema = z.object({
  staffId: z.string().min(1),
  listingId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  absentDays: z.array(z.coerce.number().int().min(1).max(31)).max(31),
  note: z.string().trim().max(300).optional(),
});

// Save the month's absent-day marks for one staff + flat, computing the pay.
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
  const { staffId, listingId, month, note } = parsed.data;
  const absentDays = [...new Set(parsed.data.absentDays)].sort((a, b) => a - b);
  const absences = absentDays.length;

  const settings = await getPlatformSettings();
  const monthlySalary = settings.staffMonthlySalary;
  const allowedHolidays = settings.staffMonthlyHolidays;
  const deductionPerDay = settings.staffDailyRate;
  const pay = computeStaffPay(monthlySalary, allowedHolidays, deductionPerDay, absences);

  const row = await prisma.staffPayroll.upsert({
    where: { staffId_listingId_month: { staffId, listingId, month } },
    update: { absentDays, absences, monthlySalary, allowedHolidays, deductionPerDay, pay, note: note || null },
    create: { staffId, listingId, month, absentDays, absences, monthlySalary, allowedHolidays, deductionPerDay, pay, note: note || null },
    include: {
      staff: { select: { name: true } },
      listing: { select: { title: true, flatNumber: true, block: true } },
    },
  });

  after(async () => {
    await syncStaffPayroll({
      month,
      staffName: row.staff.name,
      listingTitle: row.listing.title,
      flat: flatLabel(row.listing),
      absences,
      allowedHolidays,
      monthlySalary,
      deductionPerDay,
      pay,
      note: note || null,
    });
  });

  return NextResponse.json({ id: row.id, absences, pay });
}
