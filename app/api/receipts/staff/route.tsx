import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function monthBounds(input: string) {
  const [year, month] = input.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    next: new Date(Date.UTC(year, month, 1)),
  };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function flatLabel(listing: { title: string; flatNumber: string | null; block: string | null }) {
  return [listing.flatNumber || listing.title, listing.block].filter(Boolean).join(", ");
}

export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staffId");
  const month = searchParams.get("month");
  if (!staffId || !month?.match(/^\d{4}-\d{2}$/)) {
    return NextResponse.json({ error: "Missing staffId or month" }, { status: 400 });
  }

  const { start, next } = monthBounds(month);
  const [staff, settings] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: staffId },
      include: {
        attendance: {
          where: { date: { gte: start, lt: next } },
          include: { listing: { select: { title: true, flatNumber: true, block: true } } },
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    getPlatformSettings(),
  ]);

  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const total = staff.attendance.reduce((sum, row) => sum + row.amount, 0);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f9fafb",
          color: "#111827",
          fontFamily: "Arial, sans-serif",
          padding: 40,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#C8705E", fontSize: 30, fontWeight: 700 }}>StayWithMe — Staff Payout</div>
            <div style={{ color: "#6b7280", fontSize: 18, marginTop: 8 }}>Month: {month}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 16, color: "#6b7280" }}>
            <div>Generated receipt</div>
            <div>{formatDate(new Date())}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "white", border: "1px solid #e5e7eb", borderRadius: 18, padding: 22 }}>
            <div style={{ color: "#6b7280", fontSize: 15 }}>Staff</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{staff.name}</div>
            <div style={{ color: "#6b7280", fontSize: 17, marginTop: 6 }}>{staff.phone || "No phone"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 240, background: "#C8705E", color: "white", borderRadius: 18, padding: 22 }}>
            <div style={{ fontSize: 15, opacity: 0.9 }}>TOTAL</div>
            <div style={{ fontSize: 34, fontWeight: 800, marginTop: 8 }}>{formatINR(total)}</div>
            <div style={{ fontSize: 15, opacity: 0.9, marginTop: 6 }}>{staff.attendance.length} flat-days</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: "white", border: "1px solid #e5e7eb", borderRadius: 18, marginTop: 24, padding: 22 }}>
          <div style={{ display: "flex", color: "#6b7280", fontSize: 15, paddingBottom: 10, borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ width: 130 }}>Date</div>
            <div style={{ flex: 1 }}>Flat</div>
            <div style={{ width: 130, textAlign: "right" }}>Amount</div>
          </div>
          {staff.attendance.length === 0 ? (
            <div style={{ display: "flex", color: "#6b7280", fontSize: 18, paddingTop: 18 }}>No cleaning attendance recorded for this month.</div>
          ) : (
            staff.attendance.map((row) => (
              <div key={row.id} style={{ display: "flex", fontSize: 17, padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ width: 130 }}>{formatDate(row.date)}</div>
                <div style={{ flex: 1 }}>{flatLabel(row.listing)}</div>
                <div style={{ width: 130, textAlign: "right", fontWeight: 700 }}>{formatINR(row.amount)}</div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 22, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 16, padding: 18, color: "#6b7280", fontSize: 16 }}>
          <div>
            Reference monthly salary {formatINR(settings.staffMonthlySalary)}, {settings.staffMonthlyHolidays} holidays, rate {formatINR(settings.staffDailyRate)}/flat/day.
          </div>
          <div style={{ marginTop: 6 }}>This receipt is generated from flat-wise attendance entries.</div>
        </div>
      </div>
    ),
    { width: 820, height: 1160 }
  );
}
