import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { monthLabel } from "@/lib/staff";
import { StaffReceiptPdf } from "@/lib/pdf/staff-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function flat(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
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

  const [staff, settings] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: staffId },
      include: {
        payroll: {
          where: { month },
          include: { listing: { select: { title: true, flatNumber: true, block: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    getPlatformSettings(),
  ]);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const rows = staff.payroll.map((r) => ({
    flat: flat(r.listing),
    absences: r.absences,
    allowedHolidays: r.allowedHolidays,
    absentDays: r.absentDays,
    pay: r.pay,
  }));
  const total = rows.reduce((sum, r) => sum + r.pay, 0);

  const buffer = await renderToBuffer(
    StaffReceiptPdf({
      staffName: staff.name,
      staffPhone: staff.phone,
      month,
      monthLabelText: monthLabel(month),
      rows,
      total,
      monthlySalary: settings.staffMonthlySalary,
      allowedHolidays: settings.staffMonthlyHolidays,
      deductionPerDay: settings.staffDailyRate,
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
