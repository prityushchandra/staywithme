// Pure rules behind the Reserve button's "take me to the dates" behaviour.
// Kept free of React and the DOM so the visibility threshold and the prompt
// copy can be unit-tested without a browser.

/** The parts of a trip the guest still has to choose. */
export type MissingTripField = "checkIn" | "checkOut";

/** The vertical edges of an element relative to the viewport (a DOMRect subset). */
export type VerticalRect = { top: number; bottom: number };

/**
 * Chrome that covers the viewport and therefore doesn't count as "on screen":
 * the sticky navbar at the top and, on compact screens, the floating booking tab.
 */
export type ViewportInsets = { top?: number; bottom?: number };

/** How much of a section must be in the clear band before it counts as on screen. */
export const VISIBLE_RATIO_THRESHOLD = 0.4;

/**
 * The total and guest count only count as "seen" when they're all but fully in
 * the clear band — unlike a section heading, a half-visible price is useless.
 */
export const SUMMARY_VISIBLE_THRESHOLD = 0.98;

/** The sticky navbar covers the top of the viewport. */
export const NAVBAR_INSET = 64;

/** On compact screens the floating booking tab covers the bottom. */
export const BOOKING_TAB_INSET = 96;

/**
 * Fraction of `rect` sitting inside the unobstructed band of the viewport.
 *
 * A section taller than that band can never show a large fraction of its own
 * height, so the denominator is whichever of the two is smaller — filling the
 * screen counts as fully visible.
 */
export function visibleRatio(
  rect: VerticalRect,
  viewportHeight: number,
  insets: ViewportInsets = {}
): number {
  const bandTop = insets.top ?? 0;
  const bandBottom = viewportHeight - (insets.bottom ?? 0);
  const band = bandBottom - bandTop;
  const height = rect.bottom - rect.top;
  if (band <= 0 || height <= 0) return 0;

  const visible = Math.min(rect.bottom, bandBottom) - Math.max(rect.top, bandTop);
  if (visible <= 0) return 0;

  return Math.min(1, visible / Math.min(height, band));
}

/**
 * Is enough of the element on screen that scrolling to it would look broken?
 * A single visible pixel doesn't count — the guest has to be able to use it.
 */
export function isSufficientlyVisible(
  rect: VerticalRect,
  viewportHeight: number,
  options: ViewportInsets & { threshold?: number } = {}
): boolean {
  const { threshold = VISIBLE_RATIO_THRESHOLD, ...insets } = options;
  return visibleRatio(rect, viewportHeight, insets) >= threshold;
}

/**
 * The nudge shown when Reserve can't proceed and the date picker is already
 * open. Naming the one date that's missing beats a generic plea.
 */
export function datePromptMessage(
  kind: "incomplete" | "unavailable",
  missing: readonly MissingTripField[] = []
): string {
  if (kind === "unavailable") {
    return "Those dates are booked — please choose different dates";
  }
  const needsCheckIn = missing.includes("checkIn");
  const needsCheckOut = missing.includes("checkOut");
  if (needsCheckOut && !needsCheckIn) return "Please pick a checkout date";
  if (needsCheckIn && !needsCheckOut) return "Please pick a check-in date";
  return "Please choose your travel dates";
}

/**
 * Should closing the date picker carry the guest down to the price summary?
 *
 * Only when they actually settled on a *new* stay inside the picker. Dismissing
 * it, or re-opening and closing on the stay that was already chosen, must leave
 * the page where it was — an unasked-for scroll is worse than none.
 *
 * `rangeBefore` is the stay as it stood when the picker opened (`null` when the
 * picker was never seen to open, e.g. on first mount) and `rangeAfter` the stay
 * once it closed, both as an opaque key; an empty string means "no complete stay".
 */
export function shouldRevealSummary(opts: {
  rangeBefore: string | null;
  rangeAfter: string;
  isCompactLayout: boolean;
}): boolean {
  const { rangeBefore, rangeAfter, isCompactLayout } = opts;
  // From `lg` up the summary lives in a sticky card that is already on screen,
  // and scrolling a stuck element only runs the page to the end of its sticky
  // range without ever bringing the element closer.
  if (!isCompactLayout) return false;
  if (rangeBefore === null) return false;
  if (!rangeAfter) return false;
  return rangeAfter !== rangeBefore;
}
