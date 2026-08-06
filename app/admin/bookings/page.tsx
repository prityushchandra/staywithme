import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { OfflineBookingActions, OfflineBookingForm } from "@/components/admin/offline-booking-form";

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

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.includes((status as (typeof STATUSES)[number]) ?? "ALL")
    ? (status as string) ?? "ALL"
    : "ALL";

  const [bookings, listings, offlineBookings] = await Promise.all([
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
  ]);

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
              return (
                <div key={b.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{b.guestName}</span>
                        <Badge variant={b.status === "CANCELLED" ? "destructive" : "success"}>{b.status}</Badge>
                        <Badge variant="secondary">{b.source}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {flat} · {fmt(b.checkIn)} → {fmt(b.checkOut)} · {b.guests} guest{b.guests > 1 ? "s" : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Total {formatINR(b.totalPrice)} · Paid {formatINR(b.amountPaid)} · Due{" "}
                        <span className={b.due > 0 ? "font-medium text-destructive" : ""}>{formatINR(b.due)}</span>
                        {b.guestPhone ? ` · ${b.guestPhone}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/api/receipts/booking/${b.id}`}
                        target="_blank"
                        className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground"
                      >
                        Receipt
                      </Link>
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
