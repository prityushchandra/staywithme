import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { allowedLeaves, computeStaffPay, monthLabel } from "@/lib/staff";
import { StaffReceiptPdf } from "@/lib/pdf/staff-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

// Staff monthly payout as a PDF.
export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staffId");
  const month = searchParams.get("month");
  const download = searchParams.has("download");
  if (!staffId || !month?.match(/^\d{4}-\d{2}$/)) {
    return NextResponse.json({ error: "Missing staffId or month" }, { status: 400 });
  }

  const [staff, entry, settings] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, phone: true, monthlySalary: true } }),
    prisma.staffMonth.findUnique({ where: { staffId_month: { staffId, month } } }),
    getPlatformSettings(),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  // Prefer the saved month snapshot; otherwise compute a zero-absence payout from
  // the staff's current salary and settings.
  const monthlySalary = entry?.monthlySalary ?? staff.monthlySalary ?? settings.staffMonthlySalary;
  const allowed = entry?.allowedLeaves ?? allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const deductionPerDay = entry?.deductionPerDay ?? settings.staffDailyRate;
  const absentDays = entry?.absentDays ?? [];
  const absences = entry?.absences ?? absentDays.length;
  const pay = entry?.pay ?? computeStaffPay(monthlySalary, allowed, deductionPerDay, absences);

  const buffer = await renderToBuffer(
    StaffReceiptPdf({
      staffName: staff.name,
      staffPhone: staff.phone,
      month,
      monthLabelText: monthLabel(month),
      monthlySalary,
      allowedLeaves: allowed,
      deductionPerDay,
      absences,
      absentDays,
      pay,
      note: entry?.note ?? null,
    })
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="StayWithMe-staff-${staff.name.replace(/[^A-Za-z0-9._-]/g, "-")}-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
