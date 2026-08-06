import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";
import { monthLabel } from "@/lib/staff";
import { getReceiptFonts } from "@/lib/receipt-fonts";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
}

const colors = { brand: "#C8705E", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", soft: "#f9fafb" };

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

  const rows = staff.payroll;
  const total = rows.reduce((s, r) => s + r.pay, 0);
  const height = 560 + Math.max(1, rows.length) * 46;
  const fonts = await getReceiptFonts();

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", flexDirection: "column", background: "#f3f4f6", padding: 36, fontFamily: "'Noto Sans', Arial, sans-serif", color: colors.ink }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 30, background: "white", boxShadow: "0 16px 40px rgba(17,24,39,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: colors.ink, color: "white", padding: "30px 34px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", color: colors.brand, fontSize: 34, fontWeight: 900 }}>StayWithMe</div>
              <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>Staff Payout</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 800 }}>{monthLabel(month)}</div>
              <div style={{ display: "flex", color: "#d1d5db", fontSize: 17 }}>{new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 28 }}>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6, padding: 20, border: `1px solid ${colors.line}`, borderRadius: 18 }}>
                <div style={{ display: "flex", color: colors.muted, fontSize: 16 }}>STAFF</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800 }}>{staff.name}</div>
                <div style={{ display: "flex", color: colors.muted, fontSize: 19 }}>{staff.phone || "No phone"}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", width: 260, gap: 4, padding: 20, borderRadius: 18, background: colors.brand, color: "white" }}>
                <div style={{ display: "flex", fontSize: 16, opacity: 0.9 }}>NET PAYOUT</div>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 900 }}>{formatINR(total)}</div>
                <div style={{ display: "flex", fontSize: 16, opacity: 0.9 }}>{rows.length} flat{rows.length === 1 ? "" : "s"}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", border: `1px solid ${colors.line}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ display: "flex", color: colors.muted, fontSize: 16, padding: "14px 18px", background: colors.soft }}>
                <div style={{ display: "flex", flex: 1 }}>Flat</div>
                <div style={{ display: "flex", width: 120, justifyContent: "center" }}>Absent</div>
                <div style={{ display: "flex", width: 150, justifyContent: "flex-end" }}>Pay</div>
              </div>
              {rows.length === 0 ? (
                <div style={{ display: "flex", color: colors.muted, fontSize: 19, padding: 20 }}>No payroll recorded for this month.</div>
              ) : (
                rows.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", fontSize: 20, padding: "14px 18px", borderTop: `1px solid ${colors.line}` }}>
                    <div style={{ display: "flex", flex: 1, fontWeight: 700 }}>{flatLabel(r.listing)}</div>
                    <div style={{ display: "flex", width: 120, justifyContent: "center", color: r.absences > r.allowedHolidays ? "#b91c1c" : colors.muted }}>
                      {r.absences} / {r.allowedHolidays}
                    </div>
                    <div style={{ display: "flex", width: 150, justifyContent: "flex-end", fontWeight: 800 }}>{formatINR(r.pay)}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 20, borderRadius: 18, background: "#fff7ed", color: "#7c2d12", fontSize: 18 }}>
              <div style={{ display: "flex" }}>
                Base salary {formatINR(settings.staffMonthlySalary)}/flat · {settings.staffMonthlyHolidays} free holidays · then {formatINR(settings.staffDailyRate)}/extra absent day.
              </div>
              <div style={{ display: "flex", color: "#9a3412" }}>Fixed monthly salary — the same whether the month has 30 or 31 days.</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 820,
      height,
      fonts: fonts.length ? fonts : undefined,
      headers: download
        ? { "Content-Disposition": `attachment; filename="StayWithMe-staff-${staff.name.replace(/\s+/g, "-")}-${month}.png"` }
        : undefined,
    }
  );
}
