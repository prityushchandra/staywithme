import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
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
import { BOOKING_RECEIPT_MESSAGE, bookingReceiptFileName } from "@/lib/receipt-share";
import { todayInIndia } from "@/lib/pnl-compute";
import { guestWhatsAppHref as waLink } from "@/lib/guest-messages";
import { OFFLINE_GUEST_SELECT } from "@/lib/offline-booking-guests";
import { GUEST_DOCUMENT_SELECT, guestDocumentGroups, type GuestDocumentRecord } from "@/lib/booking-documents";

export type AdminBookingSearchParams = {
  status?: string;
  from?: string;
  to?: string;
  flat?: string;
  view?: string;
  source?: string;
  guest?: string;
  page?: string;
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
  idDocs: { select: GUEST_DOCUMENT_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
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
const SEARCH_PAGE_SIZE = 20;
const SEARCH_INDEX_SELECT = { id: true, checkIn: true, checkOut: true } satisfies Prisma.BookingSelect;
type BookingIndexEntry = {
  kind: "manual" | "guest";
  booking: { id: string; checkIn: Date; checkOut: Date };
};

/** Reads a yyyy-mm-dd filter value as UTC midnight; ignores anything malformed. */
function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

function bookingReceiptUrl(booking: { id: string; publicToken: string | null }) {
  const path = `/api/receipts/booking/${encodeURIComponent(booking.id)}`;
  return booking.publicToken ? `${path}?t=${encodeURIComponent(booking.publicToken)}` : path;
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
  details: readonly GuestDocumentRecord[];
  manual?: boolean;
}) {
  const groups = guestDocumentGroups(details);
  const guests = Array.from({ length: count }, (_, position) => {
    const detail = groups.find((guest) => guest.position === position);
    return { detail, name: detail?.name || (position === 0 ? primaryName : null) || "Name not added" };
  });
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-muted/30 p-3">
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
        Guests &amp; Aadhaar
        <span className="text-xs font-normal text-muted-foreground">
          {guests.filter(({ detail }) => detail && detail.documents.length > 0).length} / {count} guests with IDs
        </span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {guests.map(({ detail, name }, position) => (
          <div key={position} className="min-w-0 space-y-1 rounded-lg border bg-background p-2.5">
            <p className="break-words text-sm">Guest {position + 1}: {name}</p>
            {detail && detail.documents.length > 0 ? (
              <BookingAttachments docs={detail.documents.map((doc) => ({
                ...doc, name, source: manual ? "manual" : "guest",
              }))} />
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
  booking: b, upiId,
}: {
  booking: ManualBookingRecord;
  upiId: string;
}) {
  const flat = `${b.listing.flatNumber || b.listing.title}${b.listing.block ? `, ${b.listing.block}` : ""}`;
  const n = nights(b.checkIn, b.checkOut);
  const receiptUrl = bookingReceiptUrl(b);
  const ciTime = b.listing.checkInTime?.trim();
  const coTime = b.listing.checkOutTime?.trim();
  const checkinStr = `${fmt(b.checkIn)}${ciTime ? `, ${ciTime}` : ""}`;
  const checkoutStr = `${fmt(b.checkOut)}${coTime ? `, ${coTime}` : ""}`;
  const receiptMessage = BOOKING_RECEIPT_MESSAGE;
  const receiptChat = waLink(b.guestPhone, receiptMessage);
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
    <article data-booking-kind="manual" className="min-w-0 rounded-xl border p-4">
      <div className="space-y-4">
        <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{b.guestName}</span>
            <Badge variant={b.status === "CANCELLED" ? "destructive" : "success"}>{statusLabel(b.status)}</Badge>
            <Badge variant="secondary">Manual · {b.source === "AIRBNB" ? "Airbnb" : "Offline / walk-in"}</Badge>
            <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
          </div>
          <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm [&>dd]:min-w-0">
            <dt className="text-muted-foreground">Flat</dt>
            <dd className="font-medium">{flat}</dd>
            <dt className="text-muted-foreground">Check-in</dt>
            <dd>{checkinStr}</dd>
            <dt className="text-muted-foreground">Check-out</dt>
            <dd>{checkoutStr}</dd>
            <dt className="text-muted-foreground">Stay</dt>
            <dd>{n} night{n > 1 ? "s" : ""} · {b.guests} guest{b.guests > 1 ? "s" : ""}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Total {formatINR(b.totalPrice)}</span>
              <span>Paid {formatINR(b.amountPaid)}</span>
              <span>Due <span className={b.due > 0 ? "font-medium text-destructive" : ""}>{formatINR(b.due)}</span></span>
            </dd>
            {b.guestPhone && <><dt className="text-muted-foreground">Phone</dt><dd>{b.guestPhone}</dd></>}
            {b.note && <><dt className="text-muted-foreground">Note</dt><dd className="text-muted-foreground">{b.note}</dd></>}
          </dl>
          <GuestDetails count={b.guests} primaryName={b.guestName} details={b.guestDetails} manual />
          {b.guestPhone ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <SendReceiptButton
                key={b.updatedAt.toISOString()}
                receiptUrl={receiptUrl}
                chatLink={receiptChat}
                message={receiptMessage}
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
  const receiptUrl = bookingReceiptUrl(b);
  const n = nights(b.checkIn, b.checkOut);
  return (
    <article data-booking-kind="guest" className="min-w-0 rounded-xl border p-4">
      <div className="space-y-4">
        <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/listings/${b.listing.id}`} className="max-w-full font-semibold hover:underline">{b.listing.title}</Link>
            <Badge variant={VARIANT[b.status] ?? "secondary"}>{statusLabel(b.status)}</Badge>
            <Badge variant="secondary">Guest · {b.source === "ONLINE" ? "Paid online" : "WhatsApp"}</Badge>
            <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
          </div>
          <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm [&>dd]:min-w-0">
            <dt className="text-muted-foreground">Guest</dt>
            <dd className="font-medium">{b.guest.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Check-in</dt>
            <dd>{fmt(b.checkIn)}{b.listing.checkInTime?.trim() ? `, ${b.listing.checkInTime.trim()}` : ""}</dd>
            <dt className="text-muted-foreground">Check-out</dt>
            <dd>{fmt(b.checkOut)}{b.listing.checkOutTime?.trim() ? `, ${b.listing.checkOutTime.trim()}` : ""}</dd>
            <dt className="text-muted-foreground">Stay</dt>
            <dd>{n} night{n > 1 ? "s" : ""} · {b.guests} guest{b.guests > 1 ? "s" : ""}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Total {formatINR(b.totalAmount)}</span>
              <span>Paid {formatINR(b.amountPaid)}</span>
              <span>Due {formatINR(Math.max(0, b.totalAmount - b.amountPaid))}</span>
            </dd>
            {phone && <><dt className="text-muted-foreground">Phone</dt><dd>{phone}</dd></>}
            {b.reasonForVisit && <><dt className="text-muted-foreground">Reason</dt><dd className="whitespace-pre-wrap">{b.reasonForVisit}</dd></>}
          </dl>
          <GuestDetails count={b.guests} primaryName={b.guest.name} details={b.idDocs} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {b.amountPaid > 0 && (
              <SendReceiptButton
                key={b.updatedAt.toISOString()}
                receiptUrl={receiptUrl}
                chatLink={waLink(phone, BOOKING_RECEIPT_MESSAGE)}
                message={BOOKING_RECEIPT_MESSAGE}
                fileName={bookingReceiptFileName(b.guest.name ?? "Guest", b.checkIn)}
              />
            )}
            <GuestContactActions phone={phone} guestName={b.guest.firstName?.trim() || b.guest.name} status={b.status} listing={b.listing} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {b.amountPaid > 0 && (
            <>
              <a href={`${receiptUrl}${b.publicToken ? "&" : "?"}download=1`} download className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground">
                Download receipt
              </a>
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-foreground">
                Open
              </a>
            </>
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
  kind: "offline" | "guest" | "search";
}) {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect("/");

  const listingsRequest = prisma.listing.findMany({
    select: { id: true, title: true, flatNumber: true, block: true },
    orderBy: { title: "asc" },
  });
  if (kind === "offline") {
    const listings = await listingsRequest;
    return (
      <div className="space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground">Record a manual, Airbnb, or walk-in reservation and share its receipt.</p>
        </div>
        <Link href="/admin/booking-search?source=MANUAL" className="inline-flex rounded-full border px-3 py-1.5 text-sm hover:border-foreground">
          Find and manage existing bookings
        </Link>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Record a booking</h2>
          <OfflineBookingForm listings={listings.map((listing) => ({
            id: listing.id,
            label: `${listing.flatNumber || listing.title}${listing.block ? `, ${listing.block}` : ""}`,
          }))} />
        </section>
      </div>
    );
  }

  const guestOnly = kind === "guest";
  const searching = kind === "search";
  const basePath = guestOnly ? "/admin/guest-bookings" : "/admin/booking-search";
  const { status, from, to, flat, view, source, guest, page: pageParam } = await searchParams;
  const period = view === "past" || view === "upcoming" ? view : "all";
  const historySource = searching && (source === "GUEST" || source === "MANUAL") ? source : "ALL";
  const active = STATUSES.find((value) => value === status) ?? "ALL";
  const guestName = guest?.trim() ?? "";
  const fromDay = parseDay(from);
  const toDay = parseDay(to);
  const fromStr = fromDay ? from! : "";
  const toStr = toDay ? to! : "";
  const flatId = flat || "";
  const filterError = (from && !fromDay) || (to && !toDay)
    ? "Choose valid calendar dates."
    : fromDay && toDay && fromDay > toDay
      ? "The From date must be on or before the To date."
      : guestName.length > 120 ? "Use a guest name of 120 characters or fewer." : null;

  // A stay matches the date filter when it overlaps the range rather than when
  // it starts inside it, so a long stay still shows up in every month it runs
  // through. `to` is inclusive, hence the morning after; the checkout day isn't
  // a night, so a stay ending on `from` doesn't count as overlapping.
  const todayMs = todayInIndia(new Date());
  const stayWhere: { checkIn?: { lt: Date }; checkOut?: { gt?: Date; lte?: Date } } = {};
  if (toDay) stayWhere.checkIn = { lt: new Date(toDay.getTime() + DAY_MS) };
  if (fromDay) stayWhere.checkOut = { gt: fromDay };
  if (period === "past") stayWhere.checkOut = { ...stayWhere.checkOut, lte: new Date(todayMs) };
  if (period === "upcoming") stayWhere.checkOut = { gt: new Date(Math.max(todayMs, fromDay?.getTime() ?? 0)) };

  const flatWhere = flatId ? { listingId: flatId } : {};
  const filtersOn = Boolean(from || to || flatId || guestName || period !== "all" || historySource !== "ALL" || active !== "ALL");
  const nameMatch = { contains: guestName, mode: "insensitive" } satisfies Prisma.StringFilter;
  const guestWhere: Prisma.BookingWhereInput = {
    ...(active !== "ALL" ? { status: active } : {}),
    ...flatWhere, ...stayWhere,
    NOT: { source: "ONLINE", status: "PENDING" },
    ...(guestName ? { OR: [
      { guest: { name: nameMatch } },
      { guest: { firstName: nameMatch } },
      { idDocs: { some: { name: nameMatch } } },
    ] } : {}),
  };
  const manualWhere: Prisma.OfflineBookingWhereInput = {
    ...flatWhere, ...stayWhere,
    ...(active !== "ALL" ? { status: active } : {}),
    ...(guestName ? { OR: [
      { guestName: nameMatch },
      { guestDetails: { some: { name: nameMatch } } },
    ] } : {}),
  };

  // Merge lightweight date indexes before paging; load documents and contact
  // details only for the visible page, without truncating either booking source.
  const [guestIndex, manualIndex] = searching && !filterError ? await Promise.all([
    historySource !== "MANUAL" ? prisma.booking.findMany({ where: guestWhere, select: SEARCH_INDEX_SELECT }) : [],
    historySource !== "GUEST" ? prisma.offlineBooking.findMany({ where: manualWhere, select: SEARCH_INDEX_SELECT }) : [],
  ]) : [[], []];
  const compareStays = (a: BookingIndexEntry, b: BookingIndexEntry) => {
    const aUpcoming = a.booking.checkOut.getTime() > todayMs;
    const bUpcoming = b.booking.checkOut.getTime() > todayMs;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return (aUpcoming
      ? a.booking.checkIn.getTime() - b.booking.checkIn.getTime()
      : b.booking.checkOut.getTime() - a.booking.checkOut.getTime()) ||
      b.booking.checkIn.getTime() - a.booking.checkIn.getTime() ||
      a.kind.localeCompare(b.kind) || a.booking.id.localeCompare(b.booking.id);
  };
  const matches = [
    ...manualIndex.map((booking) => ({ kind: "manual" as const, booking })),
    ...guestIndex.map((booking) => ({ kind: "guest" as const, booking })),
  ].sort(compareStays);
  const pageCount = Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE));
  const requestedPage = Number(pageParam ?? 1);
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const pageEntries = matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE);
  const guestIds = pageEntries.filter((entry) => entry.kind === "guest").map((entry) => entry.booking.id);
  const manualIds = pageEntries.filter((entry) => entry.kind === "manual").map((entry) => entry.booking.id);
  const [bookings, listings, offlineBookings, settings, pendingOnline] = await Promise.all([
    !filterError && (guestOnly || guestIds.length > 0) ? prisma.booking.findMany({
      where: guestOnly ? guestWhere : { AND: [guestWhere, { id: { in: guestIds } }] },
      include: GUEST_BOOKING_INCLUDE,
      orderBy: { createdAt: "desc" },
      ...(guestOnly ? { take: 200 } : {}),
    }) : [],
    listingsRequest,
    manualIds.length > 0 ? prisma.offlineBooking.findMany({
      where: { AND: [manualWhere, { id: { in: manualIds } }] },
      include: MANUAL_BOOKING_INCLUDE,
    }) : [],
    getPlatformSettings(),
    // Paid online and waiting on a human. Deliberately ignores the filters —
    // money is sitting here and it must never be filtered out of sight.
    guestOnly ? prisma.booking.findMany({
      where: { status: "AWAITING_APPROVAL", source: "ONLINE" },
      include: {
        listing: { select: { title: true, flatNumber: true, checkInTime: true, checkOutTime: true } },
        guest: { select: { name: true, phone: true } },
        idDocs: { select: GUEST_DOCUMENT_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
      orderBy: { paidAt: "asc" },
      take: 50,
    }) : [],
  ]);

  const history = [
    ...offlineBookings.map((booking) => ({ kind: "manual" as const, booking })),
    ...bookings.map((booking) => ({ kind: "guest" as const, booking })),
  ].sort(compareStays);
  const filterParams = {
    status: active === "ALL" ? undefined : active, from: fromStr, to: toStr, flat: flatId,
    guest: guestName, view: period === "all" ? undefined : period,
    source: historySource === "ALL" ? undefined : historySource,
  };

  const listingOptions = listings.map((l) => ({
    id: l.id,
    label: `${l.flatNumber || l.title}${l.block ? `, ${l.block}` : ""}`,
  }));

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {guestOnly ? "Guest bookings" : "Booking search"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {guestOnly
            ? "Review paid bookings, manage guest requests, and view their documents."
            : "Find past, current and upcoming stays across every listing. Manage guest details, attachments and receipts in one place."}
        </p>
      </div>

      {guestOnly ? (
        <a href="/admin/booking-search" className="inline-flex rounded-full border px-3 py-1.5 text-sm hover:border-foreground">
          Search guest + manual bookings
        </a>
      ) : (
        <Link href="/admin/bookings" className="inline-flex rounded-full border px-3 py-1.5 text-sm hover:border-foreground">
          Record a manual booking
        </Link>
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
                  receiptUrl: bookingReceiptUrl(b),
                  receiptFileName: bookingReceiptFileName(b.guest.name ?? "Guest", b.checkIn),
                  docs: guestDocumentGroups(b.idDocs).flatMap((guest) =>
                    guest.documents.map((doc) => ({ ...doc, name: guest.name }))
                  ),
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Filters</h2>
          <p className="text-xs text-muted-foreground">
            Dates match any stay overlapping the range.
          </p>
        </div>
        <form method="get" action={basePath} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {guestOnly && active !== "ALL" && <input type="hidden" name="status" value={active} />}
          <div className="space-y-1">
            <label htmlFor="f-flat" className="text-sm font-medium">Listing</label>
            <select id="f-flat" name="flat" defaultValue={flatId} className={FIELD}>
              <option value="">All listings</option>
              {listingOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="f-guest" className="text-sm font-medium">Guest name</label>
            <input id="f-guest" name="guest" defaultValue={guestName} maxLength={120} placeholder="Primary guest or companion" className={FIELD} />
          </div>
          <div className="space-y-1">
            <label htmlFor="f-view" className="text-sm font-medium">Stay period</label>
            <select id="f-view" name="view" defaultValue={period} className={FIELD}>
              <option value="all">Past + upcoming</option>
              <option value="upcoming">Upcoming / currently staying</option>
              <option value="past">Past stays</option>
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
          {searching && (
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
                href={basePath}
                className="flex h-10 items-center rounded-lg border px-4 text-sm font-medium transition hover:border-foreground"
              >
                Clear
              </a>
            )}
          </div>
        </form>
      </section>

      {filterError && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{filterError}</p>}

      {searching && !filterError && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Bookings ({matches.length})</h2>
            <p className="text-xs text-muted-foreground">Current and upcoming stays first, then past stays by latest checkout. Unpaid online drafts are excluded.</p>
          </div>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No bookings {filtersOn ? "match these filters." : "yet."}
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => entry.kind === "manual" ? (
                <ManualBookingCard key={`manual-${entry.booking.id}`} booking={entry.booking} upiId={settings.upiId} />
              ) : (
                <GuestBookingCard key={`guest-${entry.booking.id}`} booking={entry.booking} />
              ))}
            </div>
          )}
          {pageCount > 1 && (
            <nav aria-label="Booking search pages" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * SEARCH_PAGE_SIZE + 1}-{Math.min(page * SEARCH_PAGE_SIZE, matches.length)} of {matches.length} bookings
              </p>
              <div className="flex items-center gap-3 text-sm">
                {page > 1 && <Link href={bookingsHref(basePath, { ...filterParams, page: String(page - 1) })} className="rounded-lg border px-3 py-2">Previous</Link>}
                <span>Page {page} of {pageCount}</span>
                {page < pageCount && <Link href={bookingsHref(basePath, { ...filterParams, page: String(page + 1) })} className="rounded-lg border px-3 py-2">Next</Link>}
              </div>
            </nav>
          )}
        </section>
      )}

      {guestOnly && !filterError && <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Booking history</h2>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const href = bookingsHref(basePath, {
            ...filterParams,
            status: s === "ALL" ? undefined : s,
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
      {bookings.length === 200 && <p className="text-sm text-muted-foreground">
        Showing the latest 200 guest bookings. <Link href="/admin/booking-search?source=GUEST" className="underline">Search the complete history</Link>.
      </p>}
      </section>}
    </div>
  );
}
