import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function nights(checkIn: Date, checkOut: Date) {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

function flat(listing: { title: string; flatNumber: string | null; block: string | null }) {
  const unit = listing.flatNumber ? `${listing.flatNumber}${listing.block ? `, ${listing.block}` : ""}` : "";
  return unit || listing.title;
}

const colors = {
  brand: "#C8705E",
  ink: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  soft: "#f9fafb",
  due: "#b91c1c",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 22, border: `1px solid ${colors.line}`, borderRadius: 24, background: "white" }}>
      <div style={{ display: "flex", color: colors.muted, fontSize: 18, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Pair({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", color: colors.muted, fontSize: 24 }}>{label}</div>
      <div style={{ display: "flex", color: danger ? colors.due : colors.ink, fontSize: 26, fontWeight: strong ? 800 : 600, textAlign: "right" }}>{value}</div>
    </div>
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const booking = await prisma.offlineBooking.findUnique({
    where: { id },
    include: {
      listing: {
        select: {
          title: true,
          flatNumber: true,
          block: true,
          city: true,
          wifiName: true,
          wifiPassword: true,
          checkInTime: true,
          checkOutTime: true,
          cancellationPolicy: true,
        },
      },
      receipts: { select: { number: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const [policy, settings] = await Promise.all([
    prisma.cancellationPolicyText.findUnique({ where: { policy: booking.listing.cancellationPolicy } }),
    getPlatformSettings(),
  ]);

  const receipt = booking.receipts[0];
  const stayNights = nights(booking.checkIn, booking.checkOut);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", flexDirection: "column", background: "#f3f4f6", padding: 34, fontFamily: "Arial, Helvetica, sans-serif", color: colors.ink }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 34, background: "white", boxShadow: "0 18px 45px rgba(17,24,39,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: colors.ink, padding: "34px 38px", color: "white" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", color: colors.brand, fontSize: 38, fontWeight: 900 }}>StayWithMe</div>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>Booking Receipt</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 24, fontWeight: 800 }}>{receipt?.number ?? `#${booking.id.slice(-6)}`}</div>
              <div style={{ display: "flex", color: "#d1d5db", fontSize: 18 }}>{fmtDate(receipt?.createdAt ?? booking.createdAt)}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 28 }}>
            <div style={{ display: "flex", gap: 18 }}>
              <Section title="Guest">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>{booking.guestName}</div>
                  <div style={{ display: "flex", color: colors.muted, fontSize: 22 }}>{booking.guestPhone || "Phone not provided"}</div>
                </div>
              </Section>
              <Section title="Stay">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>{flat(booking.listing)}</div>
                  <div style={{ display: "flex", color: colors.muted, fontSize: 22 }}>{booking.listing.city}</div>
                </div>
              </Section>
            </div>

            <Section title="Dates">
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 8, padding: 18, borderRadius: 18, background: colors.soft }}>
                  <div style={{ display: "flex", color: colors.muted, fontSize: 18 }}>Check-in</div>
                  <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>{fmtDate(booking.checkIn)}</div>
                  <div style={{ display: "flex", fontSize: 22 }}>{booking.listing.checkInTime ?? "—"}</div>
                </div>
                <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 8, padding: 18, borderRadius: 18, background: colors.soft }}>
                  <div style={{ display: "flex", color: colors.muted, fontSize: 18 }}>Check-out</div>
                  <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>{fmtDate(booking.checkOut)}</div>
                  <div style={{ display: "flex", fontSize: 22 }}>{booking.listing.checkOutTime ?? "—"}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: colors.muted, fontSize: 23 }}>
                <div style={{ display: "flex" }}>{stayNights} night{stayNights > 1 ? "s" : ""}</div>
                <div style={{ display: "flex" }}>{booking.guests} guest{booking.guests > 1 ? "s" : ""}</div>
              </div>
            </Section>

            <Section title="Payment">
              <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 20, borderRadius: 20, background: colors.soft }}>
                <Pair label="Total" value={formatINR(booking.totalPrice)} />
                <Pair label="Paid" value={formatINR(booking.amountPaid)} />
                <div style={{ display: "flex", height: 1, background: colors.line }} />
                <Pair label="Due" value={formatINR(booking.due)} strong danger={booking.due > 0} />
              </div>
            </Section>

            {booking.listing.wifiName && (
              <Section title="WiFi">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 18, fontSize: 24 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ color: colors.muted }}>Network</span><span style={{ fontWeight: 800 }}>{booking.listing.wifiName}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}><span style={{ color: colors.muted }}>Password</span><span style={{ fontWeight: 800 }}>{booking.listing.wifiPassword || "—"}</span></div>
                </div>
              </Section>
            )}

            <Section title="Cancellation policy">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", fontSize: 25, fontWeight: 800 }}>{policy?.title ?? booking.listing.cancellationPolicy}</div>
                <div style={{ display: "flex", color: colors.muted, fontSize: 21, lineHeight: 1.35 }}>{policy?.description ?? "Please contact StayWithMe for cancellation details."}</div>
              </div>
            </Section>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 22, borderRadius: 24, background: "#fff7ed", color: "#7c2d12", fontSize: 21, lineHeight: 1.35 }}>
              <div style={{ display: "flex" }}>{settings.smartLockNote ?? "Check-in details will be shared before arrival."}</div>
              <div style={{ display: "flex", fontWeight: 800 }}>Questions? WhatsApp {settings.whatsappNumber}</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 820, height: 1160 }
  );
}
