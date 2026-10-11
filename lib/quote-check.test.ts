import { describe, expect, it } from "vitest";
import {
  DATES_TAKEN_MESSAGE,
  PRICE_CHANGED_MESSAGE,
  compareQuote,
  parseFreshQuote,
  type FreshQuote,
  type QuoteSnapshot,
} from "./quote-check";

const shown: QuoteSnapshot = {
  basePrice: 200000,
  monthlyPrice: null,
  platformFeePercent: 10,
  total: 440000,
};

function fresh(overrides: Partial<FreshQuote> = {}): FreshQuote {
  return {
    ...shown,
    available: true,
    nights: 2,
    blockedRanges: [],
    ...overrides,
  };
}

describe("compareQuote", () => {
  it("proceeds when nothing moved since the page was rendered", () => {
    expect(compareQuote(shown, fresh())).toEqual({ kind: "proceed" });
  });

  it("blocks on dates that were booked while the guest was reading", () => {
    expect(compareQuote(shown, fresh({ available: false }))).toEqual({
      kind: "unavailable",
      message: DATES_TAKEN_MESSAGE,
    });
  });

  it("flags a changed stay total", () => {
    expect(compareQuote(shown, fresh({ total: 460000 }))).toEqual({
      kind: "price-changed",
      message: PRICE_CHANGED_MESSAGE,
    });
  });

  it("flags a changed nightly rate even when the total happens to match", () => {
    expect(compareQuote(shown, fresh({ basePrice: 210000 })).kind).toBe("price-changed");
  });

  it("flags a monthly rate appearing, since the card displays it", () => {
    expect(compareQuote(shown, fresh({ monthlyPrice: 4500000 })).kind).toBe(
      "price-changed"
    );
  });

  it("treats a null and an absent monthly rate as the same", () => {
    const withUndefined = { ...fresh(), monthlyPrice: undefined as unknown as null };
    expect(compareQuote(shown, withUndefined).kind).toBe("proceed");
  });

  it("does not interrupt for a fee percent that left the total alone", () => {
    expect(compareQuote(shown, fresh({ platformFeePercent: 12 })).kind).toBe("proceed");
  });

  it("lets availability win when both the price and the dates moved", () => {
    const outcome = compareQuote(shown, fresh({ available: false, total: 999999 }));
    expect(outcome).toEqual({ kind: "unavailable", message: DATES_TAKEN_MESSAGE });
  });
});

describe("parseFreshQuote", () => {
  it("reads a well-formed response", () => {
    const parsed = parseFreshQuote({
      available: true,
      nights: 3,
      basePrice: 200000,
      monthlyPrice: null,
      platformFeePercent: 10,
      total: 660000,
      status: "PUBLISHED",
      blockedRanges: [{ startDate: "2025-01-01", endDate: "2025-01-04" }],
    });
    expect(parsed?.total).toBe(660000);
    expect(parsed?.blockedRanges).toHaveLength(1);
  });

  it("defaults blocked ranges when the field is missing or malformed", () => {
    const parsed = parseFreshQuote({
      available: true,
      nights: 1,
      basePrice: 1,
      platformFeePercent: 10,
      total: 1,
      blockedRanges: [{ startDate: 5 }],
    });
    expect(parsed?.blockedRanges).toEqual([]);
    expect(parsed?.monthlyPrice).toBeNull();
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a missing availability flag", { total: 1, basePrice: 1, platformFeePercent: 10, nights: 1 }],
    ["a non-numeric total", { available: true, total: "1", basePrice: 1, platformFeePercent: 10, nights: 1 }],
    ["an error payload", { error: "Listing not found" }],
  ])("rejects %s so the booking falls through", (_label, payload) => {
    expect(parseFreshQuote(payload)).toBeNull();
  });
});
