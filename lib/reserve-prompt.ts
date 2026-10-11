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
 * The nudge shown when Reserve can't proceed and the calendar is already on
 * screen. Naming the one date that's missing beats a generic plea.
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
