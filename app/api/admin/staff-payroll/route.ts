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

const schema = z.object({
  staffId: z.string().min(1),
  listingId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  absences: z.coerce.number().int().min(0).max(31),
  note: z.string().trim().max(300).optional(),
});

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
}

// Record (or update) one staff member's monthly cleaning pay for one flat.
// Pay is a FIXED monthly salary minus a per-day dock for absences beyond the
// free holidays — see computeStaffPay. Snapshots the settings so history is stable.
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
  const { staffId, listingId, month, absences, note } = parsed.data;

  const settings = await getPlatformSettings();
  const monthlySalary = settings.staffMonthlySalary;
  const allowedHolidays = settings.staffMonthlyHolidays;
  const deductionPerDay = settings.staffDailyRate;
  const pay = computeStaffPay(monthlySalary, allowedHolidays, deductionPerDay, absences);

  const row = await prisma.staffPayroll.upsert({
    where: { staffId_listingId_month: { staffId, listingId, month } },
    update: { absences, monthlySalary, allowedHolidays, deductionPerDay, pay, note: note || null },
    create: { staffId, listingId, month, absences, monthlySalary, allowedHolidays, deductionPerDay, pay, note: note || null },
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

  return NextResponse.json({ id: row.id, pay });
}
