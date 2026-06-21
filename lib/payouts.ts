// Money model for reservations (all amounts in paise).
//  - Host payout  = the host's base nightly price × nights.
//  - Platform fee = what the guest paid on top (the admin's earning).
//  - Guest total  = base + platform fee.
// The guest pays the platform fee + part of the base UP FRONT to the admin; the
// remaining base (the "due") is paid DIRECTLY TO THE HOST at check-in. So of any
// amount the admin collects, the platform fee is the admin's and the rest is the
// host's base money to be forwarded.
// On cancellation the guest is refunded per the listing's cancellation policy
// (platform fee is never refunded) and the host keeps the forfeited nightly
// amount — but both are bounded by what the admin actually holds, since the due
// was never collected.

import { computePricing, computeStayBase } from "./pricing";

export interface BookingMoney {
  nights: number;
  baseTotal: number; // host nightly × nights
  platformFee: number; // admin earning
  guestTotal: number; // what the guest paid
  hostPayout: number; // = baseTotal
}

export function computeBookingMoney(
  basePrice: number,
  nights: number,
  feePercent: number,
  monthlyPrice?: number | null
): BookingMoney {
  const baseTotal = computeStayBase(basePrice, monthlyPrice, nights);
  const guestTotal = computePricing(baseTotal, { platformFeePercent: feePercent }).total;
  const platformFee = guestTotal - baseTotal;
  return { nights, baseTotal, platformFee, guestTotal, hostPayout: baseTotal };
}

/**
 * Derive the money split from a NEGOTIATED, fee-inclusive total (paise) instead
 * of the listing's DB price — e.g. the guest haggled ₹2,500/night down to ₹2,400,
 * so the agreed total is ₹2,400 × 3 + 10% = ₹7,920. From that total we recover:
 *   base (host payout) = total ÷ (1 + fee%),  fee (admin) = total − base.
 * Base is rounded to the nearest whole rupee and the fee takes the remainder, so
 * base + fee === total exactly and both are clean integer-rupee figures.
 */
export function computeBookingMoneyFromTotal(
  guestTotal: number,
  nights: number,
  feePercent: number
): BookingMoney {
  const total = Math.max(0, Math.round(guestTotal));
  // Back out the base from the fee-inclusive total, rounded to a whole rupee.
  const rawBase = total / (1 + feePercent / 100);
  const base = Math.min(total, Math.round(rawBase / 100) * 100);
  const platformFee = total - base;
  return { nights, baseTotal: base, platformFee, guestTotal: total, hostPayout: base };
}

/** Effective per-night host charge (whole rupees, paise), for display. */
export function perNightFromBase(baseTotal: number, nights: number): number {
  return Math.round(baseTotal / Math.max(1, nights) / 100) * 100;
}

export interface RefundResult {
  guestRefund: number; // back to the guest (platform fee never included)
  hostPayout: number; // forfeited nightly amount kept by the host
  platformFee: number; // admin keeps this regardless
  daysBefore: number; // days from "now" to check-in
}

// Refund per policy. The platform fee is always non-refundable, and refunds /
// host forfeits are bounded by what the admin actually collected (`amountPaid`),
// because the rest (the due) goes straight to the host at check-in and is never
// collected when a guest cancels beforehand.
export function computeRefund(
  policy: string,
  basePrice: number,
  nights: number,
  feePercent: number,
  amountPaid: number,
  checkIn: Date,
  now: Date,
  monthlyPrice?: number | null
): RefundResult {
  const { baseTotal, platformFee } = computeBookingMoney(basePrice, nights, feePercent, monthlyPrice);
  // The non-refundable "first night" is the effective nightly rate (monthly stays
  // are charged at the monthly per-night rate, not the headline base price).
  const firstNight = Math.round(baseTotal / Math.max(1, nights));
  const allButFirst = Math.max(0, baseTotal - firstNight);
  const half = Math.min(Math.round(baseTotal * 0.5), allButFirst);
  const daysBefore = Math.floor((checkIn.getTime() - now.getTime()) / 86_400_000);

  // How much of the base the guest would get back if they'd paid in full.
  let baseRefund: number;
  switch (policy) {
    case "FLEXIBLE":
      // Full refund up to 24h before; within 24h the first night is forfeited.
      baseRefund = daysBefore >= 1 ? baseTotal : allButFirst;
      break;
    case "MODERATE":
      // Full up to 5 days before; otherwise 50% (first night non-refundable).
      baseRefund = daysBefore >= 5 ? baseTotal : half;
      break;
    case "STRICT":
      // 50% up to 7 days before (first night non-refundable); else nothing.
      baseRefund = daysBefore >= 7 ? half : 0;
      break;
    default:
      baseRefund = daysBefore >= 1 ? baseTotal : allButFirst;
  }
  baseRefund = Math.max(0, Math.min(baseRefund, baseTotal));
  const forfeit = baseTotal - baseRefund; // host's cancellation fee on the base

  // Bound everything by the cash the admin is holding. The fee is the admin's;
  // the rest is the host's base money. The host keeps the forfeit (capped by
  // what's held); whatever's left of the held base money goes back to the guest.
  const adminKeeps = Math.min(amountPaid, platformFee);
  const hostHeld = Math.max(0, amountPaid - adminKeeps);
  const hostPayout = Math.min(forfeit, hostHeld);
  const guestRefund = Math.max(0, hostHeld - hostPayout);

  return { guestRefund, hostPayout, platformFee: adminKeeps, daysBefore };
}
