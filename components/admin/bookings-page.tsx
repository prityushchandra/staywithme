import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { IndianRupee } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { OfflineBookingActions, OfflineBookingForm } from "@/components/admin/offline-booking-form";
import { OfflineBookingEdit } from "@/components/admin/offline-booking-edit";
import { SendReceiptButton } from "@/components/admin/send-receipt-button";
import { OnlineBookingReview } from "@/components/admin/online-booking-review";
import { BookingAttachments } from "@/components/admin/booking-attachments";
import { GuestContactActions } from "@/components/admin/guest-contact-actions";
import { getPlatformSettings } from "@/lib/settings";
import { bookingReceiptFileName } from "@/lib/receipts";
import { guestWhatsAppHref as waLink } from "@/lib/guest-messages";
import { OFFLINE_GUEST_SELECT } from "@/lib/offline-booking-guests";

export type AdminBookingSearchParams = {
  status?: string;
  from?: string;
  to?: string;
  flat?: string;
  view?: string;
  source?: string;
};

const CONTACT_LISTING_SELECT = {
  id: true,
  title: true,
  flatNumber: true,
  block: true,
  addressLine: true,
  city: true,
  country: true,
  lat: true,
  lng: true,
  mapsUrl: true,
  checkInTime: true,
  checkOutTime: true,
  wifiName: true,
  wifiPassword: true,
} satisfies Prisma.ListingSelect;

const GUEST_BOOKING_INCLUDE = {
  listing: { select: CONTACT_LISTING_SELECT },
  guest: { select: { name: true, firstName: true, phone: true } },
  idDocs: { select: { id: true, name: true, docName: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.BookingInclude;

const MANUAL_BOOKING_INCLUDE = {
  listing: { select: CONTACT_LISTING_SELECT },
  guestDetails: { select: OFFLINE_GUEST_SELECT, orderBy: { position: "asc" } },
} satisfies Prisma.OfflineBookingInclude;

type GuestBookingRecord = Prisma.BookingGetPayload<{ include: typeof GUEST_BOOKING_INCLUDE }>;
type ManualBookingRecord = Prisma.OfflineBookingGetPayload<{ include: typeof MANUAL_BOOKING_INCLUDE }>;

const STATUSES = ["ALL", "PENDING", "AWAITING_APPROVAL", "CONFIRMED", "CANCELLED"] as const;
const VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  PENDING: "warning",
  AWAITING_APPROVAL: "warning",
  CONFIRMED: "success",
  CANCELLED: "destructive",
};

/** "AWAITING_APPROVAL" → "Awaiting approval". */
function statusLabel(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

const FIELD =
  "block h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const DAY_MS = 86_400_000;

/** Reads a yyyy-mm-dd filter value as UTC midnight; ignores anything malformed. */
function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Rebuilds the page URL, dropping any filter that isn't set. */
function bookingsHref(basePath: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Nights between two UTC-midnight dates (min 1).
function nights(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function GuestDetails({
  count, primaryName, details, manual = false,
}: {
  count: number;
  primaryName: string | null;
  details: readonly { id: string; name: string; docName: string | null; position?: number }[];
  manual?: boolean;
}) {
  const guests = Array.from({ length: count }, (_, position) => {
    const detail = manual ? details.find((guest) => guest.position === position) : details[position];
    return { detail, name: detail?.name || (position === 0 ? primaryName : null) || "Name not added" };
  });
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-muted/30 p-3">
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
        Guests &amp; Aadhaar
        <span className="text-xs font-normal text-muted-foreground">
          {details.filter((guest) => guest.docName).length} / {count} IDs uploaded
        </span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {guests.map(({ detail, name }, position) => (
          <div key={position} className="min-w-0 space-y-1 rounded-lg border bg-background p-2.5">
            <p className="break-words text-sm">Guest {position + 1}: {name}</p>
            {detail?.docName ? (
              <BookingAttachments docs={[{
                id: detail.id, name, docName: detail.docName, source: manual ? "manual" : "guest",
              }]} />
            ) : (
              <p className="text-xs text-muted-foreground">No Aadhaar / ID uploaded.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualBookingCard({
  booking: b, origin, upiId,
}: {
  booking: ManualBookingRecord;
  origin: string;
  upiId: string;
}) {
  const flat = `${b.listing.flatNumber || b.listing.title}${b.listing.block ? `, ${b.listing.block}` : ""}`;
  const n = nights(b.checkIn, b.checkOut);
  const receiptUrl = b.publicToken
    ? `${origin}/api/receipts/booking/${b.id}?t=${b.publicToken}`
    : `${origin}/api/receipts/booking/${b.id}`;
  const ciTime = b.listing.checkInTime?.trim();
  const coTime = b.listing.checkOutTime?.trim();
  const checkinStr = `${fmt(b.checkIn)}${ciTime ? `, ${ciTime}` : ""}`;
  const checkoutStr = `${fmt(b.checkOut)}${coTime ? `, ${coTime}` : ""}`;
  const receiptFallback = waLink(
    b.guestPhone,
    `Please find the booking confirmation receipt for your reference: ${receiptUrl}`
  );
  const paymentMessage =
    `checkin: ${checkinStr}\n\n` +
    `checkout: ${checkoutStr}\n\n` +
    `no. of days: ${n}\n\n` +
    `total amt: ${formatINR(b.totalPrice)}\n\n` +
    `Due amt : ${formatINR(b.due)}\n\n` +
    `u can pay the amt on this upi id: ${upiId}\n\n` +
    `will share u the checkin details a day before checkin day.`;
  const paymentLink = waLink(b.guestPhone, paymentMessage);

  return (
    <article data-booking-kind="manual" className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{b.guestName}</span>
            <Badge variant={b.status === "CANCELLED" ? "destructive" : "success"}>{statusLabel(b.status)}</Badge>
            <Badge variant="secondary">Manual · {b.source === "AIRBNB" ? "Airbnb" : "Offline / walk-in"}</Badge>
            <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Flat</dt>
            <dd className="font-medium">{flat}</dd>
            <dt className="text-muted-foreground">Dates</dt>
            <dd>{fmt(b.checkIn)} → {fmt(b.checkOut)} · {n} night{n > 1 ? "s" : ""} · {b.guests} guest{b.guests > 1 ? "s" : ""}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>
              Total {formatINR(b.totalPrice)} · Paid {formatINR(b.amountPaid)} · Due{" "}
              <span className={b.due > 0 ? "font-medium text-destructive" : ""}>{formatINR(b.due)}</span>
            </dd>
            {b.guestPhone && <><dt className="text-muted-foreground">Phone</dt><dd>{b.guestPhone}</dd></>}
            {b.note && <><dt className="text-muted-foreground">Note</dt><dd className="text-muted-foreground">{b.note}</dd></>}
          </dl>
          <GuestDetails count={b.guests} primaryName={b.guestName} details={b.guestDetails} manual />
          {b.guestPhone ? (
            <div className="flex flex-wrap items-center gap-2">
              <SendReceiptButton
                receiptUrl={receiptUrl}
                fallbackLink={receiptFallback}
                message="Please find the booking confirmation receipt for your reference."
                fileName={bookingReceiptFileName(b.guestName, b.checkIn)}
              />
              {paymentLink && (
                <a href={paymentLink} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110">
                  <IndianRupee className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-125" />
                  Payment
                </a>
              )}
              <GuestContactActions phone={b.guestPhone} guestName={b.guestName} status={b.status} listing={b.listing} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Add a phone number to message the guest.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/receipts/booking/${b.id}?download=1`} download className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground">
            Download receipt
          </a>
          <a href={`/api/receipts/booking/${b.id}`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground">
            Open
          </a>
          {b.status !== "CANCELLED" && (
            <OfflineBookingEdit booking={{
              id: b.id, listingId: b.listingId, guestName: b.guestName, guestPhone: b.guestPhone,
              guests: b.guests, checkIn: b.checkIn.toISOString(), checkOut: b.checkOut.toISOString(),
              totalPrice: b.totalPrice, amountPaid: b.amountPaid, source: b.source, note: b.note,
              guestDetails: b.guestDetails,
            }} />
          )}
          <OfflineBookingActions bookingId={b.id} status={b.status} />
        </div>
      </div>
    </article>
  );
}

function GuestBookingCard({ booking: b }: { booking: GuestBookingRecord }) {
  const phone = b.contactPhone ?? b.guest.phone;
  return (
    <article data-booking-kind="guest" className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/listings/${b.listing.id}`} className="break-words font-semibold hover:underline">{b.listing.title}</Link>
            <Badge variant={VARIANT[b.status] ?? "secondary"}>{statusLabel(b.status)}</Badge>
            <Badge variant="secondary">Guest · {b.source === "ONLINE" ? "Paid online" : "WhatsApp"}</Badge>
            <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmt(b.checkIn)} → {fmt(b.checkOut)} · {b.guests} guest{b.guests > 1 ? "s" : ""} · {formatINR(b.totalAmount)}
          </p>
          <p className="text-sm text-muted-foreground">Guest: {b.guest.name ?? "—"}{phone ? ` · ${phone}` : ""}</p>
          {b.reasonForVisit && <p className="mt-1 break-words text-sm text-muted-foreground">Reason for visit: {b.reasonForVisit}</p>}
          <GuestDetails count={b.guests} primaryName={b.guest.name} details={b.idDocs} />
          <div className="mt-2">
            <GuestContactActions phone={phone} guestName={b.guest.firstName?.trim() || b.guest.name} status={b.status} listing={b.listing} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.source === "ONLINE" && b.publicToken && b.status !== "PENDING" && (
            <a href={`/api/receipts/booking/${b.id}?t=${b.publicToken}&download=1`} download className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground">
              Receipt
            </a>
          )}
          <BookingActions bookingId={b.id} status={b.status} source={b.source} />
        </div>
      </div>
    </article>
  );
}

export async function AdminBookingsPage({
  searchParams,
  kind,
}: {
  searchParams: Promise<AdminBookingSearchParams>;
  kind: "offline" | "guest";
}) {
  const guestOnly = kind === "guest";
  const basePath = guestOnly ? "/admin/guest-bookings" : "/admin/bookings";
  const { status, from, to, flat, view, source } = await searchParams;
  const pastView = !guestOnly && view === "past";
  const historySource = pastView && (source === "GUEST" || source === "MANUAL") ? source : "ALL";
  const active = guestOnly || pastView
    ? STATUSES.find((value) => value === status) ?? "ALL"
    : "ALL";

  const fromDay = parseDay(from);
  const toDay = parseDay(to);
  const fromStr = fromDay ? from! : "";
  const toStr = toDay ? to! : "";
  const flatId = flat || "";

  // A stay matches the date filter when it overlaps the range rather than when
  // it starts inside it, so a long stay still shows up in every month it runs
  // through. `to` is inclusive, hence the morning after; the checkout day isn't
  // a night, so a stay ending on `from` doesn't count as overlapping.
  const nowMs = Date.now();
  const stayWhere: { checkIn?: { lt: Date }; checkOut?: { gt?: Date; lt?: Date } } = {};
  if (toDay) stayWhere.checkIn = { lt: new Date(toDay.getTime() + DAY_MS) };
  if (fromDay) stayWhere.checkOut = { gt: fromDay };
  if (pastView) stayWhere.checkOut = { ...stayWhere.checkOut, lt: new Date(nowMs) };

  const flatWhere = flatId ? { listingId: flatId } : {};
  const filtersOn = Boolean(fromStr || toStr || flatId || (pastView && (historySource !== "ALL" || active !== "ALL")));

  const [bookings, listings, offlineBookings, settings, pendingOnline] = await Promise.all([
    guestOnly || (pastView && historySource !== "MANUAL") ? prisma.booking.findMany({
      where: {
        ...(active && active !== "ALL" ? { status: active } : {}),
        ...flatWhere,
        ...stayWhere,
        // Abandoned "book with us" carts are not bookings — nothing was paid
        // and no dates are held, so they'd only be noise here.
        NOT: { source: "ONLINE", status: "PENDING" },
      },
      include: GUEST_BOOKING_INCLUDE,
      orderBy: pastView ? [{ checkOut: "desc" }, { checkIn: "desc" }] : { createdAt: "desc" },
      take: 200,
    }) : [],
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    guestOnly || (pastView && historySource === "GUEST") ? [] : prisma.offlineBooking.findMany({
      where: {
        ...flatWhere, ...stayWhere,
        ...(pastView && active !== "ALL" ? { status: active } : {}),
      },
      include: MANUAL_BOOKING_INCLUDE,
      ...(pastView ? { orderBy: [{ checkOut: "desc" as const }, { checkIn: "desc" as const }] } : {}),
      take: pastView ? 200 : 100,
    }),
    getPlatformSettings(),
    // Paid online and waiting on a human. Deliberately ignores the filters —
    // money is sitting here and it must never be filtered out of sight.
    guestOnly ? prisma.booking.findMany({
      where: { status: "AWAITING_APPROVAL", source: "ONLINE" },
      include: {
        listing: { select: { title: true, flatNumber: true, checkInTime: true, checkOutTime: true } },
        guest: { select: { name: true, phone: true } },
        idDocs: { select: { id: true, name: true, docName: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { paidAt: "asc" },
      take: 50,
    }) : [],
  ]);

  const origin = process.env.NEXTAUTH_URL ?? "https://staywithme.co.in";

  // Upcoming/active stays first (soonest check-in), then past stays (most recent).
  const offline = [...offlineBookings].sort((a, b) => {
    const aUpcoming = a.checkOut.getTime() >= nowMs;
    const bUpcoming = b.checkOut.getTime() >= nowMs;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return aUpcoming
      ? a.checkIn.getTime() - b.checkIn.getTime()
      : b.checkIn.getTime() - a.checkIn.getTime();
  });
  const history = [
    ...offline.map((booking) => ({ kind: "manual" as const, booking })),
    ...bookings.map((booking) => ({ kind: "guest" as const, booking })),
  ].sort((a, b) =>
    b.booking.checkOut.getTime() - a.booking.checkOut.getTime() ||
    b.booking.checkIn.getTime() - a.booking.checkIn.getTime() ||
    b.booking.id.localeCompare(a.booking.id)
  );

  const listingOptions = listings.map((l) => ({
    id: l.id,
    label: `${l.flatNumber || l.title}${l.block ? `, ${l.block}` : ""}`,
  }));

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {guestOnly ? "Guest bookings" : pastView ? "Past bookings" : "Bookings"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {guestOnly
            ? "Review paid bookings, manage guest requests, and view their documents."
            : pastView
              ? "Guest and manual bookings together, latest checkout first. View guest details, Aadhaar / IDs and receipts here."
              : "Manage offline, Airbnb, and walk-in reservations. Past bookings brings all booking sources together."}
        </p>
      </div>

      {guestOnly ? (
        <a href="/admin/bookings?view=past" className="inline-flex rounded-full border px-3 py-1.5 text-sm hover:border-foreground">
          View past guest + manual bookings
        </a>
      ) : (
        <nav aria-label="Booking views" className="flex flex-wrap gap-2">
          {[
            { label: "Manual bookings", past: false },
            { label: "Past bookings (all)", past: true },
          ].map((tab) => (
            <a
              key={tab.label}
              href={bookingsHref(basePath, { view: tab.past ? "past" : undefined, flat: flatId, from: fromStr, to: toStr })}
              aria-current={pastView === tab.past ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${pastView === tab.past ? "border-foreground bg-foreground text-background" : "hover:border-foreground"}`}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      )}

      {pendingOnline.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Online bookings awaiting your approval
              <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white align-middle">
                {pendingOnline.length}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              These guests have already paid and their dates are held. Check their
              IDs, then accept or cancel.
            </p>
          </div>
          <div className="space-y-3">
            {pendingOnline.map((b) => (
              <OnlineBookingReview
                key={b.id}
                booking={{
                  id: b.id,
                  listingTitle: `${b.listing.flatNumber || b.listing.title}`,
                  guestName: b.guest.name ?? "Guest",
                  guestPhone: b.guest.phone,
                  contactPhone: b.contactPhone,
                  checkIn: fmt(b.checkIn),
                  checkOut: fmt(b.checkOut),
                  checkInTime: b.listing.checkInTime,
                  checkOutTime: b.listing.checkOutTime,
                  nights: nights(b.checkIn, b.checkOut),
                  guests: b.guests,
                  totalAmount: b.totalAmount,
                  amountPaid: b.amountPaid,
                  reasonForVisit: b.reasonForVisit,
                  adminNote: b.adminNote,
                  paidAt: b.paidAt?.toISOString() ?? null,
                  razorpayPaymentId: b.razorpayPaymentId,
                  docs: b.idDocs,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {!guestOnly && !pastView && <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Record a booking</h2>
          <p className="text-sm text-muted-foreground">
            Add offline, Airbnb, and walk-in reservations, then share the generated receipt.
          </p>
        </div>
        <OfflineBookingForm listings={listingOptions} />
      </section>}

      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Filters</h2>
          <p className="text-xs text-muted-foreground">
            Dates match any stay overlapping the range.
          </p>
        </div>
        <form method="get" action={basePath} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pastView && <input type="hidden" name="view" value="past" />}
          {!pastView && active !== "ALL" && <input type="hidden" name="status" value={active} />}
          <div className="space-y-1">
            <label htmlFor="f-flat" className="text-sm font-medium">Flat</label>
            <select id="f-flat" name="flat" defaultValue={flatId} className={FIELD}>
              <option value="">All flats</option>
              {listingOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="f-from" className="text-sm font-medium">From</label>
            <input id="f-from" type="date" name="from" defaultValue={fromStr} className={FIELD} />
          </div>
          <div className="space-y-1">
            <label htmlFor="f-to" className="text-sm font-medium">To</label>
            <input id="f-to" type="date" name="to" defaultValue={toStr} className={FIELD} />
          </div>
          {pastView && (
            <>
              <div className="space-y-1">
                <label htmlFor="f-source" className="text-sm font-medium">Booking source</label>
                <select id="f-source" name="source" defaultValue={historySource} className={FIELD}>
                  <option value="ALL">Guest + manual bookings</option>
                  <option value="GUEST">Guest bookings</option>
                  <option value="MANUAL">Manual bookings</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="f-status" className="text-sm font-medium">Status</label>
                <select id="f-status" name="status" defaultValue={active} className={FIELD}>
                  {STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="h-10 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90"
            >
              Apply
            </button>
            {filtersOn && (
              <a
                href={bookingsHref(basePath, { view: pastView ? "past" : undefined, status: !pastView && active !== "ALL" ? active : undefined })}
                className="flex h-10 items-center rounded-lg border px-4 text-sm font-medium transition hover:border-foreground"
              >
                Clear
              </a>
            )}
          </div>
        </form>
      </section>

      {!guestOnly && !pastView && <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Offline bookings</h2>
        {offline.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            No offline bookings {filtersOn ? "match these filters." : "yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {offline.map((booking) => (
              <ManualBookingCard key={booking.id} booking={booking} origin={origin} upiId={settings.upiId} />
            ))}
          </div>
        )}
      </section>}

      {pastView && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Guest + manual booking history</h2>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No past bookings {filtersOn ? "match these filters." : "yet."}
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => entry.kind === "manual" ? (
                <ManualBookingCard key={`manual-${entry.booking.id}`} booking={entry.booking} origin={origin} upiId={settings.upiId} />
              ) : (
                <GuestBookingCard key={`guest-${entry.booking.id}`} booking={entry.booking} />
              ))}
            </div>
          )}
          {(bookings.length === 200 || offlineBookings.length === 200) && (
            <p className="text-sm text-muted-foreground">
              Showing the latest 200 matching bookings per source. Narrow the dates or flat to find older stays.
            </p>
          )}
        </section>
      )}

      {guestOnly && <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Booking history</h2>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const href = bookingsHref(basePath, {
            status: s === "ALL" ? undefined : s,
            from: fromStr,
            to: toStr,
            flat: flatId,
          });
          const isActive = active === s;
          return (
            <Link
              key={s}
              href={href}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                isActive ? "border-foreground bg-foreground text-background" : "hover:border-foreground"
              }`}
            >
              {statusLabel(s)}
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
          {bookings.map((booking) => <GuestBookingCard key={booking.id} booking={booking} />)}
        </div>
      )}
      </section>}
    </div>
  );
}
