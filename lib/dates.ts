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

/**
 * How a single calendar day behaves right now, given the pending selection.
 *
 * - `selectable`    — a normal click: starts the trip, or completes it as a checkout.
 * - `checkout-only` — an occupied night that is still reachable as a CHECKOUT
 *                     (same-day turnover): you leave the morning the next guest arrives.
 * - `restart`       — a free night that cannot complete the pending range (it sits
 *                     before the check-in, or past an occupied night). Clicking it is
 *                     NOT a dead end: it abandons the pending check-in and starts a new
 *                     trip on that day, exactly like `nextRangeSelection` already does.
 * - `blocked`       — an occupied night that can serve as neither check-in nor checkout.
 * - `past`          — before `today` (and `allowPast` is off).
 */
export type DayAvailabilityKind =
  | "selectable"
  | "checkout-only"
  | "restart"
  | "blocked"
  | "past";

export interface DayAvailability {
  kind: DayAvailabilityKind;
  /** The day button must be inert — a click can produce no valid selection. */
  disabled: boolean;
  /** Occupied night usable only as a checkout (Airbnb same-day turnover). */
  checkoutOnly: boolean;
  /** Clicking abandons the pending check-in and starts a new trip on this day. */
  restartsRange: boolean;
  /** Clicking the pending check-in again — the caller should clear the selection. */
  clearsSelection: boolean;
  /** The day is an occupied night in one of the blocks. */
  blockedNight: boolean;
  /** The day is before `today` (ignored when `allowPast`). */
  past: boolean;
}

export interface DayAvailabilityOptions {
  /** The pending (or complete) check-in, if any. */
  checkIn?: Date | null;
  /** The chosen checkout, if any. A complete range means the next click starts over. */
  checkOut?: Date | null;
  /** Booked ranges, half-open [startDate, endDate). */
  blocks?: DateRange[];
  /** Date-only "today"; omit to skip past-date filtering entirely. */
  today?: Date | null;
  /** Admin override: occupied nights stay selectable (offline bookings). */
  allowBlocked?: boolean;
  /** Admin override: past dates stay selectable (recording a stay that happened). */
  allowPast?: boolean;
}

/**
 * The single rule both calendars use to render (and gate) one day cell, so the
 * booking-card popover and the on-page availability calendar can never drift.
 *
 * The important part: a free night that merely isn't *reachable* as a checkout
 * from the pending check-in stays CLICKABLE (`kind: "restart"`). Disabling it is
 * what used to strand the guest — with nights booked inside the range they could
 * pick neither a checkout nor a new check-in. `nextRangeSelection` already
 * restarts the range on such a day; this keeps the UI from swallowing the click.
 */
export function getDayAvailability(
  day: Date,
  options: DayAvailabilityOptions = {}
): DayAvailability {
  const {
    checkIn = null,
    checkOut = null,
    blocks = [],
    today = null,
    allowBlocked = false,
    allowPast = false,
  } = options;

  const t = day.getTime();
  const past = !allowPast && !!today && t < today.getTime();
  const blockedNight = isBlockedNight(day, blocks);
  const base = { blockedNight, past, clearsSelection: false, restartsRange: false };

  const blocked: DayAvailability = {
    ...base,
    kind: "blocked",
    disabled: true,
    checkoutOnly: false,
  };
  const restart: DayAvailability = {
    ...base,
    kind: "restart",
    disabled: false,
    checkoutOnly: false,
    restartsRange: true,
  };
  const selectable: DayAvailability = {
    ...base,
    kind: "selectable",
    disabled: false,
    checkoutOnly: false,
  };

  if (past) {
    return { ...base, kind: "past", disabled: true, checkoutOnly: false };
  }

  const pendingCheckIn = checkIn && !checkOut ? checkIn : null;
  const clearsSelection = !!pendingCheckIn && t === pendingCheckIn.getTime();

  // Admin override mode: occupied nights stay selectable so a stay can be
  // recorded on top of them (the server asks the admin to confirm).
  if (allowBlocked) return { ...selectable, clearsSelection };

  if (pendingCheckIn) {
    // Re-clicking the pending check-in clears it, so there is always a way out.
    if (clearsSelection) return { ...selectable, clearsSelection: true };
    if (t > pendingCheckIn.getTime() && isSelectableCheckout(pendingCheckIn, day, blocks)) {
      return blockedNight
        ? { ...base, kind: "checkout-only", disabled: false, checkoutOnly: true }
        : selectable;
    }
    // Before the check-in, or past an occupied night → can only start over here.
    return blockedNight ? blocked : restart;
  }

  // Choosing a check-in (nothing picked yet, or a complete range → start over).
  return blockedNight ? blocked : selectable;
}

/**
 * Plain-language hint for a day cell, shared by both calendars (as `title` and
 * in the aria-label) so the three honest states always read the same way.
 */
export function dayHint(status: DayAvailability, isEndpoint = false): string | undefined {
  if (isEndpoint) return undefined;
  if (status.checkoutOnly) return "Checkout only — the next guest checks in";
  if (status.restartsRange) return "Starts a new trip";
  if (status.kind === "blocked") return "Booked";
  return undefined;
}

/** Normalise a date to UTC midnight (date-only semantics). */
export function toUtcDate(input: string | Date): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
