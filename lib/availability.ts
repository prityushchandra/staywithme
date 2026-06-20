// Availability — DB read/write for blocked/booked date ranges. The pure overlap
// helpers live in ./dates (Prisma-free, client-safe); re-exported here for
// server callers' convenience.

import { prisma } from "./db";
import { memo } from "./memo";
import { isRangeAvailable, toUtcDate } from "./dates";

export { rangesOverlap, isRangeAvailable, toUtcDate } from "./dates";
export type { DateRange } from "./dates";

// --- DB helpers ---

export async function getBlocks(listingId: string) {
  return prisma.availabilityBlock.findMany({
    where: { listingId },
    orderBy: { startDate: "asc" },
  });
}

/** Upcoming/active blocks only (endDate in the future), for display (cached). */
export function getActiveBlocks(listingId: string) {
  return memo(`active-blocks:${listingId}`, 60_000, () => {
    const todayUtc = toUtcDate(new Date());
    return prisma.availabilityBlock.findMany({
      where: { listingId, endDate: { gt: todayUtc } },
      orderBy: { startDate: "asc" },
    });
  });
}

export async function addBlock(input: {
  listingId: string;
  startDate: Date;
  endDate: Date;
  kind: "BOOKING" | "MANUAL";
  guestName?: string | null;
  guests?: number | null;
  note?: string | null;
  createdById?: string | null;
}) {
  // Reject overlaps with existing blocks.
  const existing = await getBlocks(input.listingId);
  if (!isRangeAvailable(input.startDate, input.endDate, existing)) {
    return { ok: false as const, error: "These dates overlap an existing block." };
  }
  const block = await prisma.availabilityBlock.create({ data: input });
  return { ok: true as const, block };
}

export async function removeBlock(id: string) {
  await prisma.availabilityBlock.delete({ where: { id } });
}
