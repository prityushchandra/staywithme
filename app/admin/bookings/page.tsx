import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { OfflineBookingActions, OfflineBookingForm } from "@/components/admin/offline-booking-form";
import { OfflineBookingEdit } from "@/components/admin/offline-booking-edit";
import { SendReceiptButton } from "@/components/admin/send-receipt-button";
import { getPlatformSettings } from "@/lib/settings";
import { bookingReceiptFileName } from "@/lib/receipts";

export const metadata = { title: "Admin · Bookings" };
export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "PENDING", "CONFIRMED", "CANCELLED"] as const;
const VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "destructive",
};

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Build a wa.me link carrying a prefilled message. Strips non-digits from the
// phone; assumes India (+91) for bare 10-digit numbers. Returns null if there's
// no usable number.
function waLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.includes((status as (typeof STATUSES)[number]) ?? "ALL")
    ? (status as string) ?? "ALL"
    : "ALL";

  const [bookings, listings, offlineBookings, settings] = await Promise.all([
    prisma.booking.findMany({
      where: active && active !== "ALL" ? { status: active } : {},
      include: {
        listing: { select: { id: true, title: true } },
        guest: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    prisma.offlineBooking.findMany({
      include: { listing: { select: { title: true, flatNumber: true, block: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    getPlatformSettings(),
  ]);

  const origin = process.env.NEXTAUTH_URL ?? "https://staywithme.co.in";

  const listingOptions = listings.map((l) => ({
    id: l.id,
    label: `${l.flatNumber || l.title}${l.block ? `, ${l.block}` : ""}`,
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Record a booking</h2>
          <p className="text-sm text-muted-foreground">
            Add offline, Airbnb, and walk-in reservations, then share the generated receipt.
          </p>
        </div>
        <OfflineBookingForm listings={listingOptions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Offline bookings</h2>
        {offlineBookings.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            No offline bookings yet.
          </div>
        ) : (
          <div className="space-y-3">
            {offlineBookings.map((b) => {
              const flat = `${b.listing.flatNumber || b.listing.title}${b.listing.block ? `, ${b.listing.block}` : ""}`;
              const receiptUrl = b.publicToken
                ? `${origin}/api/receipts/booking/${b.id}?t=${b.publicToken}`
                : `${origin}/api/receipts/booking/${b.id}`;
              const firstName = b.guestName.split(" ")[0] || "there";
              const payLine = `You can pay on this UPI id: ${settings.upiId}\n\nI'll share the check-in details a day before your check-in day. Please share the payment screenshot once done.`;
              // Caption when the actual PDF is attached (mobile share sheet).
              const shareMessage = `Hi ${firstName}, please find your booking receipt attached.\n\n${payLine}`;
              // Fallback text (desktop) — links to the receipt since no file is attached.
              const waMessage = `Hi ${firstName}, please find your booking receipt: ${receiptUrl}\n\n${payLine}`;
              const wa = waLink(b.guestPhone, waMessage);
              return (
                <div key={b.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{b.guestName}</span>
                        <Badge variant={b.status === "CANCELLED" ? "destructive" : "success"}>{b.status}</Badge>
                        <Badge variant="secondary">{b.source}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
                      </div>
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Flat</dt>
                        <dd className="font-medium">{flat}</dd>
                        <dt className="text-muted-foreground">Dates</dt>
                        <dd>{fmt(b.checkIn)} → {fmt(b.checkOut)} · {b.guests} guest{b.guests > 1 ? "s" : ""}</dd>
                        <dt className="text-muted-foreground">Amount</dt>
                        <dd>
                          Total {formatINR(b.totalPrice)} · Paid {formatINR(b.amountPaid)} · Due{" "}
                          <span className={b.due > 0 ? "font-medium text-destructive" : ""}>{formatINR(b.due)}</span>
                        </dd>
                        {b.guestPhone && (
                          <>
                            <dt className="text-muted-foreground">Phone</dt>
                            <dd className="flex items-center gap-2">
                              <span>{b.guestPhone}</span>
                              {wa && (
                                <SendReceiptButton
                                  receiptUrl={receiptUrl}
                                  fallbackLink={wa}
                                  message={shareMessage}
                                  fileName={bookingReceiptFileName(b.guestName, b.checkIn)}
                                />
                              )}
                            </dd>
                          </>
                        )}
                        {b.note && (
                          <>
                            <dt className="text-muted-foreground">Note</dt>
                            <dd className="text-muted-foreground">{b.note}</dd>
                          </>
                        )}
                      </dl>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/api/receipts/booking/${b.id}?download=1`}
                        download
                        className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground"
                      >
                        Download receipt
                      </a>
                      <a
                        href={`/api/receipts/booking/${b.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground"
                      >
                        Open
                      </a>
                      {b.status !== "CANCELLED" && (
                        <OfflineBookingEdit
                          booking={{
                            id: b.id,
                            listingId: b.listingId,
                            guestName: b.guestName,
                            guestPhone: b.guestPhone,
                            guests: b.guests,
                            checkIn: b.checkIn.toISOString(),
                            checkOut: b.checkOut.toISOString(),
                            totalPrice: b.totalPrice,
                            amountPaid: b.amountPaid,
                            source: b.source,
                            note: b.note,
                          }}
                        />
                      )}
                      <OfflineBookingActions bookingId={b.id} status={b.status} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <h2 className="text-xl font-semibold tracking-tight">WhatsApp Bookings</h2>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const href = s === "ALL" ? "/admin/bookings" : `/admin/bookings?status=${s}`;
          const isActive = active === s;
          return (
            <Link
              key={s}
              href={href}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                isActive ? "border-foreground bg-foreground text-background" : "hover:border-foreground"
              }`}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </Link>
          );
        })}
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          No bookings in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/listings/${b.listing.id}`} className="break-words font-semibold hover:underline">
                      {b.listing.title}
                    </Link>
                    <Badge variant={VARIANT[b.status] ?? "secondary"}>{b.status}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fmt(b.checkIn)} → {fmt(b.checkOut)} · {b.guests} guest{b.guests > 1 ? "s" : ""} ·{" "}
                    {formatINR(b.totalAmount)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Guest: {b.guest.name ?? "—"}
                    {b.guest.phone ? ` · ${b.guest.phone}` : ""}
                  </p>
                </div>
                <BookingActions bookingId={b.id} status={b.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
