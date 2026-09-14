// Shared helpers for generated receipts (booking + staff payouts).
import { prisma } from "./db";

const RECEIPT_NUMBER = /^SWM-\d{4}-(\d+)$/;

/**
 * Next human-friendly receipt number, e.g. "SWM-2026-0007".
 *
 * Counts UP from the highest number ever issued, not from how many receipts
 * currently exist. Deleting a booking deletes its receipt, so a count-based
 * sequence starts handing out numbers that are already taken — and because
 * Receipt.number is unique, every later booking fails to save. The sequence is
 * continuous across years; only the year label changes.
 */
export async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const issued = await prisma.receipt.findMany({ select: { number: true } });

  let highest = 0;
  for (const { number } of issued) {
    const seq = RECEIPT_NUMBER.exec(number);
    if (!seq) continue;
    const n = Number(seq[1]);
    if (n > highest) highest = n;
  }

  return `SWM-${year}-${String(highest + 1).padStart(4, "0")}`;
}

/** True when a write failed because Receipt.number was already taken. */
function isDuplicateReceiptNumber(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  // No target reported means we cannot tell which constraint tripped; assume
  // it was ours and let the retry decide.
  return fields.length === 0 || fields.some((f) => f.toLowerCase().includes("number"));
}

/**
 * Runs `save` with a freshly issued receipt number, retrying if another write
 * claimed that number first. The number is derived from the receipts already
 * issued rather than a database sequence, so two writes in the same moment can
 * pick the same one; that should cost a retry, not the booking.
 */
export async function withReceiptNumber<T>(
  save: (receiptNumber: string) => Promise<T>
): Promise<{ result: T; receiptNumber: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const receiptNumber = await nextReceiptNumber();
    try {
      return { result: await save(receiptNumber), receiptNumber };
    } catch (error) {
      if (!isDuplicateReceiptNumber(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
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
