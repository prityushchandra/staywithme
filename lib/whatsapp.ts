// WhatsApp inquiry — the GLOBAL, locked contact channel.
//
// RULES (permanent, structural):
//  - Every inquiry routes to the platform number from PlatformSettings.
//  - Hosts can never edit/replace/hide/disable the number or add their own contact.
//  - The number lives only in PlatformSettings (admin-only). No listing field
//    touches contact info.
//
// This module is pure: it builds the link + message from data passed in.

import { formatINR } from "./pricing";

export interface InquiryDetails {
  propertyName: string;
  /** Real listing id (cuid) — used for tracking/links, NOT shown to the guest. */
  propertyId: string;
  /** Short human ref shown as "Ref:" (e.g. "K7M2Q"). Falls back to propertyId. */
  refCode?: string;
  /** Name of the guest making the reservation (from their account). */
  guestName?: string;
  /** Guest's own phone (E.164) — they're booking for themselves. */
  guestPhone?: string;
  /** ISO ("yyyy-mm-dd") or human string; pass "" when not chosen */
  checkIn?: string;
  checkOut?: string;
  /** host-set check-in / check-out times, e.g. "3:00 PM" */
  checkInTime?: string;
  checkOutTime?: string;
  /** number of nights; computed from the dates when omitted */
  nights?: number;
  guests?: number;
  /** displayed total in MINOR units (paise) */
  totalMinorUnits: number;
}

/** Strip everything but digits from a stored number like "+91 8789194107". */
export function normalizeWhatsAppNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Format a "yyyy-mm-dd" value as e.g. "Jun 20, 2026"; leave other strings as-is. */
function formatStayDate(value?: string): string {
  if (!value?.trim()) return "Not selected";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Build the pre-populated reservation message. Greets the platform contact,
 * names the guest, and lists the stay details + total.
 */
export function buildInquiryMessage(details: InquiryDetails): string {
  const nights =
    details.nights ??
    (details.checkIn && details.checkOut
      ? Math.max(
          0,
          Math.round(
            (Date.parse(details.checkOut) - Date.parse(details.checkIn)) /
              86_400_000
          )
        )
      : 0);

  // Clean, spaced lines — easy to read on a phone, and still easy for the bot to
  // parse when the admin forwards this message in the confirm flow.
  const name = details.guestName?.trim();
  const ci = details.checkInTime?.trim() ? ` (${details.checkInTime.trim()})` : "";
  const co = details.checkOutTime?.trim() ? ` (${details.checkOutTime.trim()})` : "";
  const lines = [
    `Hi Chandra${name ? `, this is *${name}*` : ""}.`,
    "",
    "I'd like to book this stay:",
    "",
    `*${details.propertyName}*`,
    `Ref: ${details.refCode ?? details.propertyId}`,
    "",
    `Check-in: ${details.checkIn || "—"}${ci}`,
    `Check-out: ${details.checkOut || "—"}${co}`,
    `Nights: ${nights > 0 ? nights : "—"} · Guests: ${details.guests && details.guests > 0 ? details.guests : "—"}`,
    "",
    `Total: *${formatINR(details.totalMinorUnits)}*`,
    "",
    `My contact: ${details.guestPhone || "—"}`,
    "",
    "Please confirm availability. Thank you!",
  ];
  return lines.join("\n");
}

/**
 * Build the full wa.me link to the platform number with the encoded message.
 * @param whatsappNumber raw number from PlatformSettings (e.g. "+918789194107")
 */
export function buildWhatsAppLink(
  whatsappNumber: string,
  details: InquiryDetails
): string {
  const number = normalizeWhatsAppNumber(whatsappNumber);
  const text = encodeURIComponent(buildInquiryMessage(details));
  return `https://wa.me/${number}?text=${text}`;
}
