// Self-serve online bookings: the guest pays us directly instead of haggling on
// WhatsApp. The lifecycle is deliberately four-staged so money and dates are
// never out of step:
//
//   PENDING            draft — guest is still filling in IDs. Holds nothing.
//   AWAITING_APPROVAL  paid and verified. Dates ARE held from this moment.
//   CONFIRMED          admin accepted. This is the only status P&L counts.
//   CANCELLED          admin rejected (no refund, per policy) — dates released.
//
// Dates are held the instant payment verifies rather than on approval, because
// a guest who has already been debited must not lose their nights to someone
// slower-but-luckier while the admin sleeps.
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { prisma } from "./db";
import { clearMemo } from "./memo";
import { isRangeAvailable } from "./dates";
import { sendWhatsApp, sendNotification } from "./wa-send";
import { formatINR, computePricing, computeStayBase, nightlyPrice } from "./pricing";
import { getPlatformSettings } from "./settings";
import { unitBlock } from "./bookings";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  listRazorpayOrderPayments,
  verifyRazorpayPaymentSignature,
} from "./razorpay";
import crypto from "crypto";

const DAY_MS = 86_400_000;
/** Longest stay the online path will take money for. */
export const MAX_NIGHTS = 365;
export { MAX_DOC_BYTES, ALLOWED_DOC_MIMES } from "./booking-documents";

export type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const nightsBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Blocks that could clash with [checkIn, checkOut), read live (no cache). */
async function overlappingBlocks(listingId: string, checkIn: Date, checkOut: Date) {
  return prisma.availabilityBlock.findMany({
    where: { listingId, startDate: { lt: checkOut }, endDate: { gt: checkIn } },
    select: { id: true },
  });
}

/**
 * Price a stay from the database, never from the client. The booking card sends
 * its own total too, but it is only ever used to detect a stale page — the
 * amount we charge comes from here.
 */
export async function quoteStay(
  listingId: string,
  checkIn: Date,
  checkOut: Date
): Promise<
  | { ok: true; total: number; nights: number; available: boolean; title: string }
  | Fail
> {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return fail("Check-out must be after check-in.");
  if (nights > MAX_NIGHTS) return fail("That stay is too long to book online.");

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      status: true,
      basePrice: true,
      discountedPrice: true,
      monthlyPrice: true,
    },
  });
  if (!listing || listing.status !== "PUBLISHED") return fail("Listing not found.");

  const [blocks, settings] = await Promise.all([
    prisma.availabilityBlock.findMany({
      where: { listingId, endDate: { gt: checkIn } },
      select: { startDate: true, endDate: true },
    }),
    getPlatformSettings(),
  ]);

  const { total } = computePricing(
    computeStayBase(nightlyPrice(listing), listing.monthlyPrice, nights),
    { platformFeePercent: settings.platformFeePercent }
  );

  return {
    ok: true,
    total,
    nights,
    available: isRangeAvailable(checkIn, checkOut, blocks),
    title: listing.title,
  };
}

/**
 * Start a draft. Nothing is held and no money moves — this exists so the guest's
 * ID documents have a row to hang off while they are being uploaded one by one.
 * A draft left behind costs nothing: PENDING holds no dates and never reaches P&L.
 */
export async function startOnlineBooking(input: {
  listingId: string;
  guestId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  contactPhone?: string | null;
}): Promise<
  | {
      ok: true;
      bookingId: string;
      total: number;
      nights: number;
      /** IDs already attached to a reused draft, so the form can show them again. */
      docs: { id: string; name: string; docName: string; docSize: number }[];
    }
  | Fail
> {
  const quote = await quoteStay(input.listingId, input.checkIn, input.checkOut);
  if (!quote.ok) return quote;
  if (!quote.available) return fail("Those dates have just been taken. Please pick another range.");

  // Reuse the guest's own unpaid draft for the same listing and dates instead of
  // littering the table every time they reopen the sheet.
  const existing = await prisma.booking.findFirst({
    where: {
      guestId: input.guestId,
      listingId: input.listingId,
      status: "PENDING",
      source: "ONLINE",
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    },
    select: { id: true },
  });

  const data = {
    guests: input.guests,
    totalAmount: quote.total,
    contactPhone: input.contactPhone || null,
  };

  const booking = existing
    ? await prisma.booking.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.booking.create({
        data: {
          ...data,
          listingId: input.listingId,
          guestId: input.guestId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          status: "PENDING",
          source: "ONLINE",
          amountPaid: 0,
        },
        select: { id: true },
      });

  const docs = existing
    ? await prisma.bookingGuest.findMany({
        where: { bookingId: booking.id },
        select: { id: true, name: true, docName: true, docSize: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return { ok: true, bookingId: booking.id, total: quote.total, nights: quote.nights, docs };
}

/**
 * Create the Razorpay order for a draft. Re-prices and re-checks availability
 * first: the guest may have spent ten minutes uploading IDs, and we must not
 * take money for nights that went in the meantime.
 */
export async function createBookingOrder(
  bookingId: string,
  guestId: string
): Promise<
  | { ok: true; razorpayOrderId: string; amount: number; description: string }
  | Fail
> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      guestId: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      guests: true,
      status: true,
      reasonForVisit: true,
      razorpayOrderId: true,
      _count: { select: { idDocs: true } },
    },
  });
  if (!booking || booking.guestId !== guestId) return fail("Booking not found.");
  if (booking.status !== "PENDING") return fail("This booking has already been paid for.");
  if (!booking.reasonForVisit?.trim()) return fail("Please tell us the reason for your visit.");
  if (booking._count.idDocs < booking.guests) {
    return fail("Please upload an ID for every guest before paying.");
  }

  const quote = await quoteStay(booking.listingId, booking.checkIn, booking.checkOut);
  if (!quote.ok) return quote;
  if (!quote.available) return fail("Those dates have just been taken. Please pick another range.");

  const order = await createRazorpayOrder(quote.total, `stay_${booking.id.slice(-12)}`, {
    bookingId: booking.id,
    listingId: booking.listingId,
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: { totalAmount: quote.total, razorpayOrderId: order.id },
  });

  return {
    ok: true,
    razorpayOrderId: order.id,
    amount: order.amount,
    description: `${quote.title} · ${quote.nights} night${quote.nights === 1 ? "" : "s"}`,
  };
}

/**
 * Verify a completed checkout and hold the dates.
 *
 * Idempotent: replaying the same handler payload (double-tap, retry, a webhook
 * racing the browser) returns the already-held booking instead of creating a
 * second block.
 */
export async function confirmBookingPayment(
  bookingId: string,
  guestId: string,
  payload: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
): Promise<{ ok: true; alreadyDone: boolean } | Fail> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      guestId: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      guests: true,
      status: true,
      totalAmount: true,
      razorpayOrderId: true,
      blockId: true,
    },
  });
  if (!booking || booking.guestId !== guestId) return fail("Booking not found.");
  if (booking.status !== "PENDING") return { ok: true, alreadyDone: true };
  if (!booking.razorpayOrderId || booking.razorpayOrderId !== payload.razorpay_order_id) {
    return fail("That payment does not belong to this booking.");
  }
  if (
    !verifyRazorpayPaymentSignature(
      payload.razorpay_order_id,
      payload.razorpay_payment_id,
      payload.razorpay_signature
    )
  ) {
    return fail("We could not verify that payment. Please contact us before trying again.");
  }

  // Trust the gateway over the browser for the amount actually captured.
  const captured = await fetchRazorpayPayment(payload.razorpay_payment_id).catch(() => null);
  const amountPaid = captured?.amount ?? booking.totalAmount;

  await holdAndNotify(booking, payload.razorpay_payment_id, amountPaid);
  return { ok: true, alreadyDone: false };
}

/**
 * Last-resort reconciliation: the guest was debited but the browser died before
 * /verify landed, so there is no signature to check. We ask Razorpay directly
 * whether the order has a captured payment, which is authoritative.
 */
export async function reconcileBookingPayment(
  bookingId: string,
  guestId: string
): Promise<{ ok: true; paid: boolean } | Fail> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      guestId: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      guests: true,
      status: true,
      totalAmount: true,
      razorpayOrderId: true,
      blockId: true,
    },
  });
  if (!booking || booking.guestId !== guestId) return fail("Booking not found.");
  if (booking.status !== "PENDING") return { ok: true, paid: true };
  if (!booking.razorpayOrderId) return { ok: true, paid: false };

  const payments = await listRazorpayOrderPayments(booking.razorpayOrderId).catch(() => []);
  const captured = payments.find((p) => p.status === "captured");
  if (!captured) return { ok: true, paid: false };

  await holdAndNotify(booking, captured.id, captured.amount);
  return { ok: true, paid: true };
}

type PayableBooking = {
  id: string;
  listingId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  totalAmount: number;
};

/**
 * Shared tail of both payment paths: hold the nights, move to AWAITING_APPROVAL
 * and tell the admin.
 *
 * If the nights went while the guest was paying we still record the money — the
 * guest really was debited — but we create no block and flag the booking so the
 * admin sees the clash immediately and can refund. Silently double-booking a
 * flat would be far worse than an awkward phone call.
 */
async function holdAndNotify(
  booking: PayableBooking,
  paymentId: string,
  amountPaid: number
): Promise<void> {
  const clashes = await overlappingBlocks(booking.listingId, booking.checkIn, booking.checkOut);
  const conflicted = clashes.length > 0;

  const guestRow = await prisma.booking.findUnique({
    where: { id: booking.id },
    select: { guest: { select: { name: true, phone: true } } },
  });

  let blockId: string | null = null;
  if (!conflicted) {
    const block = await prisma.availabilityBlock.create({
      data: {
        listingId: booking.listingId,
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        kind: "BOOKING",
        guestName: guestRow?.guest.name ?? undefined,
        guests: booking.guests,
        note: "Paid online — awaiting approval",
      },
    });
    blockId = block.id;
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "AWAITING_APPROVAL",
      amountPaid,
      paidAt: new Date(),
      razorpayPaymentId: paymentId,
      blockId,
      publicToken: crypto.randomUUID().replace(/-/g, ""),
      adminNote: conflicted
        ? "DATE CONFLICT — these nights were already blocked when the payment landed. Refund or re-house the guest."
        : null,
    },
  });

  revalidateTag("listings");
  clearMemo();
  notifyAdminNewOnlineBooking(booking.id, conflicted);
}

/** Admin accepts: the booking becomes CONFIRMED and starts counting in P&L. */
export async function approveOnlineBooking(id: string): Promise<{ ok: true } | Fail> {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      blockId: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      guests: true,
      totalAmount: true,
      amountPaid: true,
      guest: { select: { name: true, phone: true } },
      listing: {
        select: {
          title: true,
          flatNumber: true,
          block: true,
          checkInTime: true,
          checkOutTime: true,
          host: { select: { name: true, phone: true } },
        },
      },
    },
  });
  if (!booking) return fail("Booking not found.");
  if (booking.status === "CONFIRMED") return { ok: true };
  if (booking.status !== "AWAITING_APPROVAL") {
    return fail("Only a paid booking can be approved.");
  }

  // A conflicted booking never got a block; give it one now if the clash cleared.
  let blockId = booking.blockId;
  if (!blockId) {
    const clashes = await overlappingBlocks(booking.listingId, booking.checkIn, booking.checkOut);
    if (clashes.length) {
      return fail("Those nights are still blocked — free them first, or cancel and refund.");
    }
    const block = await prisma.availabilityBlock.create({
      data: {
        listingId: booking.listingId,
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        kind: "BOOKING",
        guestName: booking.guest.name ?? undefined,
        guests: booking.guests,
      },
    });
    blockId = block.id;
  } else {
    await prisma.availabilityBlock.update({
      where: { id: blockId },
      data: { note: booking.guest.name ?? null },
    });
  }

  await prisma.booking.update({
    where: { id },
    data: { status: "CONFIRMED", approvedAt: new Date(), blockId, adminNote: null },
  });

  revalidateTag("listings");
  clearMemo();

  const l = booking.listing;
  const ub = unitBlock(l);
  const ciStr = `${fmt(booking.checkIn)}${l.checkInTime ? ` (${l.checkInTime})` : ""}`;
  const coStr = `${fmt(booking.checkOut)}${l.checkOutTime ? ` (${l.checkOutTime})` : ""}`;
  const hostContact = `${l.host.name ?? "your host"}${l.host.phone ? ` (${l.host.phone})` : ""}`;

  if (booking.guest.phone) {
    const body = `*Booking confirmed*\n\n*${l.title}*\nLocation: *${ub}*\n\nCheck-in: ${ciStr}\nCheck-out: ${coStr}\n\nTotal: *${formatINR(booking.totalAmount)}*\nPaid: ${formatINR(booking.amountPaid)}\n*Fully paid — thank you!*\n\nFor any check-in queries, reach out to your host: *${hostContact}*`;
    const params = [
      l.title,
      ub,
      ciStr,
      coStr,
      formatINR(booking.totalAmount),
      formatINR(booking.amountPaid),
      "None — fully paid",
      hostContact,
    ];
    const phone = booking.guest.phone;
    after(() => sendNotification(phone, "bookingGuest", params, body));
  }
  if (l.host.phone) {
    const guestLine = `${booking.guest.name ?? "—"} (${booking.guest.phone ?? "no number"})`;
    const body = `*New booking confirmed*\n*${ub}*\n\nGuest: ${guestLine}\n\nCheck-in: ${ciStr}\nCheck-out: ${coStr}\n\nPaid online in full.`;
    const params = [ub, guestLine, ciStr, coStr, "Nothing — fully paid", formatINR(0)];
    const phone = l.host.phone;
    after(() => sendNotification(phone, "bookingHost", params, body));
  }

  return { ok: true };
}

/**
 * Admin rejects: the nights are released and the guest is told. Per the stated
 * policy this issues no refund — the money stays with us and any goodwill
 * refund is handled manually from the Razorpay dashboard.
 */
export async function rejectOnlineBooking(
  id: string,
  note?: string
): Promise<{ ok: true } | Fail> {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      blockId: true,
      checkIn: true,
      checkOut: true,
      guest: { select: { phone: true } },
      listing: { select: { title: true } },
    },
  });
  if (!booking) return fail("Booking not found.");
  if (booking.status === "CANCELLED") return { ok: true };

  if (booking.blockId) {
    await prisma.availabilityBlock.deleteMany({ where: { id: booking.blockId } });
  }
  await prisma.booking.update({
    where: { id },
    data: {
      status: "CANCELLED",
      blockId: null,
      cancelledAt: new Date(),
      adminNote: note?.trim() || null,
    },
  });

  revalidateTag("listings");
  clearMemo();

  if (booking.guest.phone) {
    const reason = note?.trim() ? `\n\nReason: ${note.trim()}` : "";
    const phone = booking.guest.phone;
    after(() =>
      sendWhatsApp(
        phone,
        `*Booking could not be confirmed*\n\n*${booking.listing.title}*\n${fmt(booking.checkIn)} → ${fmt(booking.checkOut)}${reason}\n\nPlease reply here and we'll sort it out with you.`
      )
    );
  }
  return { ok: true };
}

/** WhatsApp the admin that money has landed and a booking needs a decision. */
export function notifyAdminNewOnlineBooking(bookingId: string, conflicted: boolean): void {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return;
  after(async () => {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        guests: true,
        checkIn: true,
        checkOut: true,
        amountPaid: true,
        reasonForVisit: true,
        guest: { select: { name: true, phone: true } },
        listing: { select: { title: true, flatNumber: true, block: true } },
        _count: { select: { idDocs: true } },
      },
    });
    if (!b) return;
    const warn = conflicted
      ? "\n\n*⚠ DATE CONFLICT — these nights were already blocked. Refund or re-house.*"
      : "";
    await sendWhatsApp(
      adminPhone,
      `*Online booking paid — approval needed*\n\nFlat: ${unitBlock(b.listing)} — ${b.listing.title}\nGuest: ${b.guest.name ?? "—"} (${b.guest.phone ?? "no number"})\nDates: ${fmt(b.checkIn)} → ${fmt(b.checkOut)}\nGuests: ${b.guests} · IDs uploaded: ${b._count.idDocs}\nReason: ${b.reasonForVisit ?? "—"}\n\nPaid: *${formatINR(b.amountPaid)}*${warn}\n\nReview the IDs and accept it in the admin dashboard.`
    );
  });
}
