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

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
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

  const [staff, entry, settings, listings] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, phone: true, monthlySalary: true, allowedLeaves: true } }),
    prisma.staffMonth.findUnique({ where: { staffId_month: { staffId, month } } }),
    getPlatformSettings(),
    prisma.listing.findMany({ select: { id: true, title: true, flatNumber: true, block: true } }),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const monthlySalary = entry?.monthlySalary ?? staff.monthlySalary ?? settings.staffMonthlySalary;
  const allowed = entry?.allowedLeaves ?? staff.allowedLeaves ?? allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const deductionPerDay = entry?.deductionPerDay ?? settings.staffDailyRate;
  const absentByDay = (entry?.absentByDay as Record<string, string[]> | undefined) ?? {};
  const absences = entry?.absences ?? 0;
  const pay = entry?.pay ?? computeStaffPay(monthlySalary, allowed, deductionPerDay, absences);

  // Per-flat summary: how many days each flat was missed, and on which days.
  const labelOf = new Map(listings.map((l) => [l.id, flatLabel(l)]));
  const perFlat = new Map<string, number[]>();
  for (const [day, ids] of Object.entries(absentByDay)) {
    for (const id of ids) {
      const list = perFlat.get(id) ?? [];
      list.push(Number(day));
      perFlat.set(id, list);
    }
  }
  const flatSummary = [...perFlat.entries()]
    .map(([id, days]) => ({ flat: labelOf.get(id) ?? "Unknown flat", days: days.length, dayList: days.sort((a, b) => a - b) }))
    .sort((a, b) => b.days - a.days);

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
      flatSummary,
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
