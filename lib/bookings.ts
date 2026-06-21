// Reservation lifecycle, driven by the admin via the WhatsApp bot (after taking
// payment). reserveForGuest → blocks the dates + notifies host & guest with the
// money split; cancelBooking → policy refund + notifies. Side-effect WhatsApp
// messages go through lib/twilio (no-op log when unconfigured).

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { prisma } from "./db";
import { clearMemo } from "./memo";
import { toUtcDate } from "./dates";
import { sendWhatsApp, sendNotification } from "./wa-send";
import { formatINR } from "./pricing";
import { getPlatformSettings } from "./settings";
import { computeBookingMoney, computeBookingMoneyFromTotal, perNightFromBase, computeRefund } from "./payouts";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
const range = (a: Date, b: Date) => `${fmt(a)} → ${fmt(b)}`;
const nightsBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

const bookingInclude = {
  listing: { include: { host: true } },
  guest: true,
} as const;

async function isRangeFree(listingId: string, checkIn: Date, checkOut: Date) {
  const clash = await prisma.availabilityBlock.findFirst({
    where: { listingId, startDate: { lt: checkOut }, endDate: { gt: checkIn } },
    select: { id: true },
  });
  return !clash;
}

// "L1203, Paradise" — the host's own identifying details (flat + block).
export function unitBlock(listing: { flatNumber: string | null; block: string | null }) {
  return `${listing.flatNumber ?? "—"}, ${listing.block ?? "—"}`;
}

// Admin creates a CONFIRMED reservation for a known guest, recording how much
// was paid (the rest is the guest's due).
export async function reserveForGuest(input: {
  listingId: string;
  guestId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  amountPaid?: number; // paise received so far
  /**
   * Negotiated, fee-inclusive total (paise). When set, the whole money split —
   * host payout, platform fee, per-night — is derived from THIS total instead of
   * the listing's DB price (the guest haggled the headline rate down/up).
   */
  guestTotal?: number;
}): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const { listingId, guestId, checkIn, checkOut, guests } = input;
  if (nightsBetween(checkIn, checkOut) <= 0)
    return { ok: false, error: "Check-out must be after check-in." };
  if (!(await isRangeFree(listingId, checkIn, checkOut)))
    return { ok: false, error: "Those dates are already blocked." };

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { host: true },
  });
  if (!listing) return { ok: false, error: "Listing not found." };
  const guest = await prisma.user.findUnique({ where: { id: guestId } });
  if (!guest) return { ok: false, error: "Guest not found." };

  const settings = await getPlatformSettings();
  const nights = nightsBetween(checkIn, checkOut);
  // A negotiated total overrides the listing price; otherwise compute from the DB.
  const negotiated = input.guestTotal && input.guestTotal > 0;
  const money = negotiated
    ? computeBookingMoneyFromTotal(input.guestTotal!, nights, settings.platformFeePercent)
    : computeBookingMoney(listing.basePrice, nights, settings.platformFeePercent, listing.monthlyPrice);
  const perNight = perNightFromBase(money.baseTotal, nights);
  const paid = Math.max(0, Math.min(input.amountPaid ?? 0, money.guestTotal));
  const due = money.guestTotal - paid;
  // The due is paid by the guest DIRECTLY to the host at check-in, so the admin
  // only forwards (base − due) to the host and keeps the rest as the fee.
  const hostFromAdmin = Math.max(0, money.hostPayout - due);
  const adminEarning = paid - hostFromAdmin;

  // Block the dates with the guest's name as the note.
  const block = await prisma.availabilityBlock.create({
    data: {
      listingId,
      startDate: checkIn,
      endDate: checkOut,
      kind: "BOOKING",
      guestName: guest.name ?? undefined,
      guests,
      note: due > 0 ? `${guest.name ?? ""} (due ${formatINR(due)})` : guest.name ?? undefined,
    },
  });
  await prisma.booking.create({
    data: {
      listingId,
      guestId,
      checkIn,
      checkOut,
      guests,
      totalAmount: money.guestTotal,
      amountPaid: paid,
      status: "CONFIRMED",
      blockId: block.id,
    },
  });

  revalidateTag("listings");
  clearMemo();

  const r = range(checkIn, checkOut);
  const ciT = listing.checkInTime ? ` (${listing.checkInTime})` : "";
  const coT = listing.checkOutTime ? ` (${listing.checkOutTime})` : "";

  // Notify host + guest AFTER the admin's reply is sent. On Vercel a bare
  // fire-and-forget promise gets killed when the function returns, so we use
  // next/server `after()` — it keeps the work alive past the response while
  // still not blocking the admin's reply. sendWhatsApp swallows its own errors.
  // Host: unit/block + guest + dates. If there's a due, the host collects it from
  // the guest at check-in, so we recalc the payout the admin forwards (base−due).
  const ub = unitBlock(listing);
  const ciStr = `${fmt(checkIn)}${ciT}`;
  const coStr = `${fmt(checkOut)}${coT}`;
  const guestLine = `${guest.name ?? "—"} (${guest.phone ?? "no number"})`;
  // Phrases that read naturally whether or not there's a balance due — templates
  // can't drop a line, so the "no due" case becomes a worded value, not "₹0".
  const dueToHostPhrase = due > 0 ? `${formatINR(due)} (pay to your host at check-in)` : "None — fully paid";
  const collectFromGuestPhrase = due > 0 ? `${formatINR(due)} (at check-in)` : "Nothing — fully paid";
  if (listing.host.phone) {
    const collectLine = due > 0 ? `Collect the guest's balance of *${formatINR(due)}* on check-in day.\n\n` : "";
    const hostBody = `*New booking confirmed*\n*${ub}*\n\nGuest: ${guestLine}\n\nCheck-in: ${ciStr}\nCheck-out: ${coStr}\n\n${collectLine}Your payout on check-in: *${formatINR(hostFromAdmin)}*`;
    const hostParams = [ub, guestLine, ciStr, coStr, collectFromGuestPhrase, formatINR(hostFromAdmin)];
    after(() => sendNotification(listing.host.phone!, "bookingHost", hostParams, hostBody));
  }
  // Guest: confirmation with location + dates + due (pays the balance to the host).
  const hostContact = `${listing.host.name ?? "your host"}${listing.host.phone ? ` (${listing.host.phone})` : ""}`;
  if (guest.phone) {
    const dueBlock = due > 0
      ? `Amount due: *${formatINR(due)}*\n\nPlease pay the balance of *${formatINR(due)}* to your host on check-in day.`
      : "*Fully paid — thank you!*";
    const guestBody = `*Booking confirmed*\n\n*${listing.title}*\nLocation: *${ub}*\n\nCheck-in: ${ciStr}\nCheck-out: ${coStr}\n\nTotal: *${formatINR(money.guestTotal)}*\nPaid: ${formatINR(paid)}\n${dueBlock}\n\nFor any check-in queries, reach out to your host: *${hostContact}*`;
    const guestParams = [listing.title, ub, ciStr, coStr, formatINR(money.guestTotal), formatINR(paid), dueToHostPhrase, hostContact];
    after(() => sendNotification(guest.phone!, "bookingGuest", guestParams, guestBody));
  }

  const priceLine = `${formatINR(perNight)}/night × ${nights} = ${formatINR(money.baseTotal)}${negotiated ? " (negotiated)" : ""}`;
  return {
    ok: true,
    summary: `*Reserved*\n*${listing.title}* (${unitBlock(listing)})\n${r}\n\nGuest: ${guest.name ?? guest.phone}\n\n${priceLine}\nTotal (with fee): *${formatINR(money.guestTotal)}*\n\nReceived: ${formatINR(paid)} · Due (guest pays host): *${formatINR(due)}*\nHost payout: ${formatINR(hostFromAdmin)} · Your earning: *${formatINR(adminEarning)}*`,
  };
}

// Cancel a confirmed reservation: policy refund, free the dates, notify all.
export async function cancelBooking(
  id: string
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.status === "CANCELLED")
    return { ok: false, error: "Already cancelled." };

  const settings = await getPlatformSettings();
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const refund = computeRefund(
    booking.listing.cancellationPolicy,
    booking.listing.basePrice,
    nights,
    settings.platformFeePercent,
    booking.amountPaid,
    booking.checkIn,
    new Date(),
    booking.listing.monthlyPrice
  );

  if (booking.blockId) {
    await prisma.availabilityBlock.deleteMany({ where: { id: booking.blockId } });
  }
  await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED", blockId: null },
  });

  revalidateTag("listings");
  clearMemo();

  const r = range(booking.checkIn, booking.checkOut);
  const { host } = booking.listing;
  const { guest } = booking;
  const ub = unitBlock(booking.listing);
  // Notify after the reply (see reserveForGuest) — survives on serverless.
  if (guest.phone) {
    const guestBody = `*Booking cancelled*\n\n*${booking.listing.title}*\n${r}\n\nRefund: *${formatINR(refund.guestRefund)}*\n(the platform fee is non-refundable)`;
    const guestParams = [booking.listing.title, r, formatINR(refund.guestRefund)];
    after(() => sendNotification(guest.phone!, "cancelGuest", guestParams, guestBody));
  }
  if (host.phone) {
    const hostBody = `*Reservation cancelled*\n*${ub}*\n${r}\n\nYour earning: *${formatINR(refund.hostPayout)}* (as per the cancellation policy)\n\nThe dates are open again.`;
    const hostParams = [ub, r, formatINR(refund.hostPayout)];
    after(() => sendNotification(host.phone!, "cancelHost", hostParams, hostBody));
  }

  return {
    ok: true,
    summary: `*Cancelled* ${booking.listing.title}\n${r} · ${guest.name ?? guest.phone}\n\nGuest refund: ${formatINR(refund.guestRefund)}\nHost keeps: ${formatINR(refund.hostPayout)}\nYour earning: *${formatINR(refund.platformFee)}*`,
  };
}

/** For the in-app admin page: confirm a still-PENDING booking (rarely used). */
export async function confirmBooking(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.status === "CONFIRMED") return { ok: true };
  const res = await reserveForGuest({
    listingId: booking.listingId,
    guestId: booking.guestId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guests: booking.guests,
    amountPaid: booking.amountPaid,
    // Preserve a negotiated total already captured on the pending stub.
    guestTotal: booking.totalAmount > 0 ? booking.totalAmount : undefined,
  });
  if (!res.ok) return res;
  // reserveForGuest created a fresh CONFIRMED booking; drop the old PENDING stub.
  await prisma.booking.delete({ where: { id } }).catch(() => {});
  return { ok: true };
}

/** Resolve a short id (last 6 chars, as used in bot messages) to a booking. */
export async function findByShortId(shortId: string) {
  const s = shortId.replace(/^#/, "").trim().toLowerCase();
  const candidates = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: bookingInclude,
  });
  return candidates.find((b) => b.id.slice(-6).toLowerCase() === s) ?? null;
}

/** Find CONFIRMED bookings whose dates exactly match (used by "cancel <start> <end>"). */
export async function findConfirmedByDates(checkInYmd: string, checkOutYmd: string) {
  return prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      checkIn: toUtcDate(checkInYmd),
      checkOut: toUtcDate(checkOutYmd),
    },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

// ---------- admin notifications (something needs moderation) ----------
// WhatsApp the admin when a host submits a listing or a guest leaves a review.
// Fire-and-forget via after() so the API response isn't blocked.
export function notifyAdminNewListing(listingId: string): void {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return;
  after(async () => {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { host: true },
    });
    if (!listing) return;
    const h = listing.host;
    await sendWhatsApp(
      adminPhone,
      `*New listing submitted for review*\n\nHost: ${h.name ?? "—"} (${h.phone ?? "no number"})\nFlat: ${unitBlock(listing)}\nTitle: ${listing.title}\n\nReview & publish it in the admin dashboard.`
    );
  });
}

export function notifyAdminNewReview(reviewId: string): void {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return;
  after(async () => {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { author: true, listing: true },
    });
    if (!review) return;
    const a = review.author;
    await sendWhatsApp(
      adminPhone,
      `*New review submitted*\n\nGuest: ${a.name ?? "—"} (${a.phone ?? "no number"})\nFlat: ${unitBlock(review.listing)} — ${review.listing.title}\nRating: ${review.rating}/5\n\nApprove it in the admin dashboard.`
    );
  });
}

export function notifyAdminListingUpdated(listingId: string): void {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return;
  after(async () => {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { host: true },
    });
    if (!listing) return;
    const h = listing.host;
    await sendWhatsApp(
      adminPhone,
      `*Listing updated — needs re-review*\n\nHost: ${h.name ?? "—"} (${h.phone ?? "no number"})\nFlat: ${unitBlock(listing)}\nTitle: ${listing.title}\n\nReview & re-publish it in the admin dashboard.`
    );
  });
}

/** Find a listing by its short refCode (the "Ref" in the guest enquiry). */
export async function findListingByRefCode(refCode: string) {
  return prisma.listing.findFirst({
    where: { refCode: { equals: refCode.trim(), mode: "insensitive" } },
  });
}

/** Listings matching a unit + block (the bot's identifier instead of an id). */
export async function findListingsByUnitBlock(unit: string, block: string) {
  return prisma.listing.findMany({
    where: {
      flatNumber: { equals: unit.trim(), mode: "insensitive" },
      block: { equals: block.trim(), mode: "insensitive" },
    },
    include: { host: true },
  });
}

/** A listing matching host phone + unit + block (used by block/unblock). */
export async function findListingByHostUnitBlock(
  hostPhone: string,
  unit: string,
  block: string
) {
  return prisma.listing.findFirst({
    where: {
      host: { phone: hostPhone },
      flatNumber: { equals: unit.trim(), mode: "insensitive" },
      block: { equals: block.trim(), mode: "insensitive" },
    },
    include: { host: true },
  });
}

// 3-days-before-check-in reminders → guest (now gets host contact + unit/block),
// host (guest details, ready the flat), admin (status). Deduped via
// reminderSentAt. Returns how many bookings were reminded.
export async function runCheckinReminders(): Promise<number> {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3));
  const targetEnd = new Date(target.getTime() + 86_400_000);
  const dueList = await prisma.booking.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, checkIn: { gte: target, lt: targetEnd } },
    include: bookingInclude,
  });
  if (!dueList.length) return 0;

  for (const b of dueList) {
    const r = range(b.checkIn, b.checkOut);
    const ciT = b.listing.checkInTime ? ` (${b.listing.checkInTime})` : "";
    const coT = b.listing.checkOutTime ? ` (${b.listing.checkOutTime})` : "";
    const due = b.totalAmount - b.amountPaid;
    const host = b.listing.host;
    const guest = b.guest;

    const ub = unitBlock(b.listing);
    const ciStr = `${fmt(b.checkIn)}${ciT}`;
    const coStr = `${fmt(b.checkOut)}${coT}`;
    const hostContact = `${host.name ?? "Your host"}${host.phone ? ` (${host.phone})` : ""}`;
    const guestLine = `${guest.name ?? "—"} (${guest.phone ?? "no number"})`;
    const dueToHostPhrase = due > 0 ? `${formatINR(due)} (pay to your host at check-in)` : "None — fully paid";
    const collectFromGuestPhrase = due > 0 ? `${formatINR(due)} (at check-in)` : "Nothing — fully paid";
    if (guest.phone) {
      const dueLine =
        due > 0
          ? `Balance due: *${formatINR(due)}* — please pay this to your host on check-in day.\n\n`
          : "";
      const guestBody = `*Reminder — your stay is in 3 days*\n\n*${b.listing.title}*\n\nCheck-in: ${ciStr}\nCheck-out: ${coStr}\n\nAddress: *${ub}*\nHost: ${hostContact}\n\n${dueLine}For any queries about the flat, please reach out to your host.\n\nSee you soon!`;
      const guestParams = [b.listing.title, ciStr, coStr, ub, hostContact, dueToHostPhrase];
      await sendNotification(guest.phone, "reminderGuest", guestParams, guestBody);
    }
    if (host.phone) {
      const collectLine = due > 0 ? `Collect their balance of *${formatINR(due)}* on check-in day.\n\n` : "";
      const hostBody = `*Reminder — guest arriving in 3 days*\n*${ub}*\n${r}\n\nGuest: ${guestLine}\n\n${collectLine}Please get the flat ready for a great stay.`;
      const hostParams = [ub, r, guestLine, collectFromGuestPhrase];
      await sendNotification(host.phone, "reminderHost", hostParams, hostBody);
    }
    const adminPhone = process.env.ADMIN_PHONE;
    if (adminPhone) {
      await sendWhatsApp(
        adminPhone,
        `Reminder sent · ${unitBlock(b.listing)} (${r})\nHost details shared with ${guest.name ?? guest.phone}.\n${due > 0 ? `Guest pays ${formatINR(due)} to the host at check-in.` : "No due."}`
      );
    }
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
  }
  return dueList.length;
}
