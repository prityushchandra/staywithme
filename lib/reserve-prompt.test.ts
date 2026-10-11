import { describe, it, expect } from "vitest";
import {
  datePromptMessage,
  isSufficientlyVisible,
  shouldRevealSummary,
  visibleRatio,
  VISIBLE_RATIO_THRESHOLD,
} from "./reserve-prompt";

const VIEWPORT = 800;

describe("visibleRatio", () => {
  it("is 0 for a section entirely below or above the viewport", () => {
    expect(visibleRatio({ top: 900, bottom: 1400 }, VIEWPORT)).toBe(0);
    expect(visibleRatio({ top: -600, bottom: -100 }, VIEWPORT)).toBe(0);
  });

  it("measures the on-screen slice of a short section", () => {
    // 200px tall, bottom 100px hangs below the fold.
    expect(visibleRatio({ top: 700, bottom: 900 }, VIEWPORT)).toBeCloseTo(0.5);
  });

  it("treats a section taller than the viewport as fully visible when it fills it", () => {
    // 2000px calendar, scrolled so it covers the whole screen.
    expect(visibleRatio({ top: -500, bottom: 1500 }, VIEWPORT)).toBe(1);
  });

  it("discounts the band hidden by the navbar and the floating booking tab", () => {
    // 100px section sitting under the 96px mobile booking tab.
    const rect = { top: 710, bottom: 810 };
    expect(visibleRatio(rect, VIEWPORT)).toBeCloseTo(0.9);
    expect(visibleRatio(rect, VIEWPORT, { top: 64, bottom: 96 })).toBe(0);
  });

  it("guards against a zero-height element or a fully obstructed viewport", () => {
    expect(visibleRatio({ top: 100, bottom: 100 }, VIEWPORT)).toBe(0);
    expect(visibleRatio({ top: 0, bottom: 800 }, VIEWPORT, { top: 400, bottom: 400 })).toBe(0);
  });
});

describe("isSufficientlyVisible", () => {
  it("rejects a sliver peeking at the edge, accepts a usable chunk", () => {
    // 400px section with only 8px showing at the bottom of the screen.
    expect(isSufficientlyVisible({ top: 792, bottom: 1192 }, VIEWPORT)).toBe(false);
    // Same section, two thirds on screen.
    expect(isSufficientlyVisible({ top: 530, bottom: 930 }, VIEWPORT)).toBe(true);
  });

  it("switches exactly at the threshold", () => {
    const height = 400;
    const visible = height * VISIBLE_RATIO_THRESHOLD;
    const top = VIEWPORT - visible;
    expect(isSufficientlyVisible({ top, bottom: top + height }, VIEWPORT)).toBe(true);
    expect(isSufficientlyVisible({ top: top + 1, bottom: top + 1 + height }, VIEWPORT)).toBe(false);
  });

  it("honours a custom threshold", () => {
    const rect = { top: 700, bottom: 900 }; // half visible
    expect(isSufficientlyVisible(rect, VIEWPORT, { threshold: 0.75 })).toBe(false);
    expect(isSufficientlyVisible(rect, VIEWPORT, { threshold: 0.25 })).toBe(true);
  });
});

describe("datePromptMessage", () => {
  it("names the single missing date", () => {
    expect(datePromptMessage("incomplete", ["checkOut"])).toBe(
      "Please pick a checkout date"
    );
    expect(datePromptMessage("incomplete", ["checkIn"])).toBe(
      "Please pick a check-in date"
    );
  });

  it("falls back to the generic ask when both dates are missing", () => {
    expect(datePromptMessage("incomplete", ["checkIn", "checkOut"])).toBe(
      "Please choose your travel dates"
    );
    expect(datePromptMessage("incomplete")).toBe("Please choose your travel dates");
  });

  it("explains booked dates instead of asking for any dates", () => {
    expect(datePromptMessage("unavailable")).toMatch(/booked/i);
  });
});

describe("shouldRevealSummary", () => {
  const compact = { isCompactLayout: true };

  it("reveals the summary when a new stay was chosen in the picker", () => {
    expect(
      shouldRevealSummary({ ...compact, rangeBefore: "", rangeAfter: "2026-01-02/2026-01-05" })
    ).toBe(true);
    expect(
      shouldRevealSummary({
        ...compact,
        rangeBefore: "2026-01-02/2026-01-05",
        rangeAfter: "2026-02-10/2026-02-14",
      })
    ).toBe(true);
  });

  it("stays put when the picker closed on the stay it opened with", () => {
    expect(
      shouldRevealSummary({
        ...compact,
        rangeBefore: "2026-01-02/2026-01-05",
        rangeAfter: "2026-01-02/2026-01-05",
      })
    ).toBe(false);
  });

  it("stays put when the picker was dismissed without a complete stay", () => {
    expect(shouldRevealSummary({ ...compact, rangeBefore: "", rangeAfter: "" })).toBe(false);
  });

  it("stays put when the picker was never seen to open", () => {
    expect(
      shouldRevealSummary({ ...compact, rangeBefore: null, rangeAfter: "2026-01-02/2026-01-05" })
    ).toBe(false);
  });

  it("never scrolls the desktop layout, where the summary card is sticky", () => {
    expect(
      shouldRevealSummary({
        isCompactLayout: false,
        rangeBefore: "",
        rangeAfter: "2026-01-02/2026-01-05",
      })
    ).toBe(false);
  });
});
