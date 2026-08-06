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
