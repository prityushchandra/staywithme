// Shared helpers for generated receipts (booking + staff payouts).
import { prisma } from "./db";

/**
 * Next human-friendly receipt number, e.g. "SWM-2026-0007". Sequential by the
 * count of receipts so far (single-operator scale; the Receipt.number unique
 * constraint is the final guard). Pass a pre-counted value to avoid a re-query.
 */
export async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.receipt.count();
  return `SWM-${year}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Friendly download name for a booking receipt, e.g.
 * "booking_receipt_ravi_kumar_2026-08-15.pdf" — from the guest's name and
 * their check-in date. The name is slugified to safe filename characters and
 * the date is the UTC calendar day (bookings are stored at UTC midnight).
 */
export function bookingReceiptFileName(guestName: string, checkIn: Date): string {
  const name =
    guestName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "guest";
  const date = checkIn.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `booking_receipt_${name}_${date}.pdf`;
}
