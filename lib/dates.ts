// Pure date-range helpers — NO Prisma / server imports, so they are safe to use
// in client components. Ranges are half-open: [start, end). A stay occupies
// nights start..end-1, so a checkout matching another stay's check-in is fine.

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Two half-open ranges [aStart,aEnd) and [bStart,bEnd) overlap. */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** A requested [checkIn, checkOut) is available iff it overlaps no block. */
export function isRangeAvailable(
  checkIn: Date,
  checkOut: Date,
  blocks: DateRange[]
): boolean {
  if (checkOut.getTime() <= checkIn.getTime()) return false;
  return !blocks.some((b) => rangesOverlap(checkIn, checkOut, b.startDate, b.endDate));
}

/** Normalise a date to UTC midnight (date-only semantics). */
export function toUtcDate(input: string | Date): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
