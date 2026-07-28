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

/**
 * Is `day` an occupied (booked) NIGHT in any block? Ranges are half-open, so a
 * block [start, end) occupies nights start..end-1 — the exclusive `end` (the
 * previous guest's checkout morning) is NOT occupied.
 */
export function isBlockedNight(day: Date, blocks: DateRange[]): boolean {
  const t = day.getTime();
  return blocks.some((b) => t >= b.startDate.getTime() && t < b.endDate.getTime());
}

/**
 * Given a chosen check-in, is `day` a valid CHECK-OUT? Every night in
 * [checkIn, day) must be free — but the checkout day itself MAY be a booked
 * night: you check out that morning as the next guest checks in (same-day
 * turnover), exactly like Airbnb. So the first booked night after a run of free
 * nights is a selectable "checkout-only" date, while anything past it is not.
 *
 * This is the single source of truth the date picker and the server share, so
 * what a guest can pick always matches what the booking API will accept.
 */
export function isSelectableCheckout(
  checkIn: Date,
  day: Date,
  blocks: DateRange[]
): boolean {
  // isRangeAvailable already treats a block starting exactly on `day` as
  // non-overlapping (half-open [checkIn, day)), which is precisely the
  // checkout-only rule.
  return isRangeAvailable(checkIn, day, blocks);
}

export interface RangeSelection {
  checkIn: Date | null;
  checkOut: Date | null;
}

/**
 * Reduce a calendar day click to the next {checkIn, checkOut} selection, using
 * Airbnb's rules against the booked ranges. Returns `null` when the click should
 * be ignored (e.g. trying to check IN on an occupied night). This is the single
 * source of truth shared by BOTH on-page calendars, so selecting dates behaves
 * identically everywhere and always matches what the server will accept.
 *
 * - Nothing selected yet, or a full range already chosen → begin a new range on
 *   `day` (only if `day` is a bookable, non-occupied night).
 * - A check-in is set and `day` is on/before it → restart on `day`.
 * - A check-in is set and `day` is after it → complete the range when every
 *   night in [checkIn, day) is free. The checkout day itself may be an occupied
 *   night (same-day turnover). If the range would span an occupied night,
 *   restart on `day` instead (when `day` is itself bookable).
 */
export function nextRangeSelection(
  current: RangeSelection,
  day: Date,
  blocks: DateRange[]
): RangeSelection | null {
  const { checkIn, checkOut } = current;
  const startingNew = !checkIn || !!checkOut;

  if (startingNew) {
    if (isBlockedNight(day, blocks)) return null;
    return { checkIn: day, checkOut: null };
  }
  if (day.getTime() <= checkIn!.getTime()) {
    if (isBlockedNight(day, blocks)) return null;
    return { checkIn: day, checkOut: null };
  }
  if (isSelectableCheckout(checkIn!, day, blocks)) {
    return { checkIn, checkOut: day };
  }
  // Range would cross an occupied night → treat as a fresh check-in if possible.
  if (isBlockedNight(day, blocks)) return null;
  return { checkIn: day, checkOut: null };
}

/** Normalise a date to UTC midnight (date-only semantics). */
export function toUtcDate(input: string | Date): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
