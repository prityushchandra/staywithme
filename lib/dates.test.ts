import { describe, it, expect } from "vitest";
import {
  rangesOverlap,
  isRangeAvailable,
  toUtcDate,
  isBlockedNight,
  isSelectableCheckout,
  nextRangeSelection,
  type DateRange,
} from "./dates";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("rangesOverlap", () => {
  it("detects clear overlap", () => {
    expect(rangesOverlap(d("2026-07-10"), d("2026-07-15"), d("2026-07-12"), d("2026-07-20"))).toBe(true);
  });
  it("treats adjacent ranges as non-overlapping (checkout == checkin)", () => {
    expect(rangesOverlap(d("2026-07-10"), d("2026-07-14"), d("2026-07-14"), d("2026-07-18"))).toBe(false);
  });
  it("detects nested ranges", () => {
    expect(rangesOverlap(d("2026-07-10"), d("2026-07-20"), d("2026-07-12"), d("2026-07-14"))).toBe(true);
  });
  it("returns false for fully disjoint ranges", () => {
    expect(rangesOverlap(d("2026-07-01"), d("2026-07-05"), d("2026-07-10"), d("2026-07-12"))).toBe(false);
  });
});

describe("isRangeAvailable", () => {
  const blocks = [
    { startDate: d("2026-07-10"), endDate: d("2026-07-14") },
    { startDate: d("2026-07-20"), endDate: d("2026-07-22") },
  ];
  it("is available in a free gap", () => {
    expect(isRangeAvailable(d("2026-07-14"), d("2026-07-20"), blocks)).toBe(true);
  });
  it("is unavailable when overlapping a block", () => {
    expect(isRangeAvailable(d("2026-07-12"), d("2026-07-16"), blocks)).toBe(false);
  });
  it("rejects an empty or inverted range", () => {
    expect(isRangeAvailable(d("2026-07-15"), d("2026-07-15"), blocks)).toBe(false);
    expect(isRangeAvailable(d("2026-07-16"), d("2026-07-15"), blocks)).toBe(false);
  });
});

describe("toUtcDate", () => {
  it("strips time to UTC midnight", () => {
    expect(toUtcDate("2026-07-10T18:30:00Z").toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});

describe("isBlockedNight", () => {
  // Block [Aug 2, Aug 4) occupies the NIGHTS of Aug 2 and Aug 3.
  const blocks = [{ startDate: d("2026-08-02"), endDate: d("2026-08-04") }];
  it("flags occupied nights", () => {
    expect(isBlockedNight(d("2026-08-02"), blocks)).toBe(true);
    expect(isBlockedNight(d("2026-08-03"), blocks)).toBe(true);
  });
  it("does NOT flag the exclusive checkout morning", () => {
    expect(isBlockedNight(d("2026-08-04"), blocks)).toBe(false);
  });
  it("does not flag a free day before the block", () => {
    expect(isBlockedNight(d("2026-08-01"), blocks)).toBe(false);
  });
  it("is false when there are no blocks", () => {
    expect(isBlockedNight(d("2026-08-02"), [])).toBe(false);
  });
});

describe("isSelectableCheckout — Airbnb same-day turnover", () => {
  // The reported scenario: Aug 1 is free, Aug 2 is booked (block [Aug2, Aug3)).
  const blocks = [{ startDate: d("2026-08-02"), endDate: d("2026-08-03") }];

  it("ALLOWS checkout on the first booked date (Jul 31 → Aug 2, the reported bug)", () => {
    // 2 nights: Jul 31 + Aug 1; checkout Aug 2 (a booked night) must be allowed.
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-02"), blocks)).toBe(true);
  });
  it("ALLOWS a 1-night stay checking out onto the booked date (Aug 1 → Aug 2)", () => {
    expect(isSelectableCheckout(d("2026-08-01"), d("2026-08-02"), blocks)).toBe(true);
  });
  it("REJECTS a checkout past the booked night (Jul 31 → Aug 3 spans Aug 2)", () => {
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-03"), blocks)).toBe(false);
  });
  it("REJECTS checking straight through the block (Jul 31 → Aug 4)", () => {
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-04"), blocks)).toBe(false);
  });
  it("REJECTS a zero-night or inverted checkout", () => {
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-07-31"), blocks)).toBe(false);
    expect(isSelectableCheckout(d("2026-08-01"), d("2026-07-31"), blocks)).toBe(false);
  });
  it("ALLOWS a normal checkout in a fully free calendar", () => {
    expect(isSelectableCheckout(d("2026-07-10"), d("2026-07-14"), [])).toBe(true);
  });

  // A multi-night block: checkout may land only on its FIRST night.
  const multi = [{ startDate: d("2026-08-02"), endDate: d("2026-08-05") }]; // Aug 2,3,4 booked
  it("allows checkout onto the first night of a multi-night block", () => {
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-02"), multi)).toBe(true);
  });
  it("rejects checkout onto a later night of a multi-night block", () => {
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-03"), multi)).toBe(false);
    expect(isSelectableCheckout(d("2026-07-31"), d("2026-08-04"), multi)).toBe(false);
  });

  // Back-to-back bookings: a free night sandwiched by two blocks stays bookable.
  const sandwich = [
    { startDate: d("2026-08-02"), endDate: d("2026-08-03") }, // Aug 2 booked
    { startDate: d("2026-08-04"), endDate: d("2026-08-05") }, // Aug 4 booked
  ];
  it("allows a single free night between two bookings (Aug 3 → Aug 4)", () => {
    // Check in Aug 3 (free night), check out Aug 4 (next booking's check-in).
    expect(isSelectableCheckout(d("2026-08-03"), d("2026-08-04"), sandwich)).toBe(true);
  });
  it("rejects check-in on an occupied night even to a valid-looking checkout", () => {
    // Aug 2 is booked, so a stay starting Aug 2 is never available.
    expect(isSelectableCheckout(d("2026-08-02"), d("2026-08-03"), sandwich)).toBe(false);
  });
});

describe("nextRangeSelection — the shared calendar click rule", () => {
  const free: DateRange[] = [];
  const blocks = [{ startDate: d("2026-08-02"), endDate: d("2026-08-03") }]; // Aug 2 booked

  it("starts a new range on a free day", () => {
    expect(
      nextRangeSelection({ checkIn: null, checkOut: null }, d("2026-07-31"), free)
    ).toEqual({ checkIn: d("2026-07-31"), checkOut: null });
  });
  it("ignores a click to check in on an occupied night", () => {
    expect(
      nextRangeSelection({ checkIn: null, checkOut: null }, d("2026-08-02"), blocks)
    ).toBeNull();
  });
  it("completes a normal range", () => {
    expect(
      nextRangeSelection({ checkIn: d("2026-07-10"), checkOut: null }, d("2026-07-13"), free)
    ).toEqual({ checkIn: d("2026-07-10"), checkOut: d("2026-07-13") });
  });
  it("completes a checkout-only range onto the first booked night (the reported bug)", () => {
    expect(
      nextRangeSelection({ checkIn: d("2026-07-31"), checkOut: null }, d("2026-08-02"), blocks)
    ).toEqual({ checkIn: d("2026-07-31"), checkOut: d("2026-08-02") });
  });
  it("restarts when the click is on/before the current check-in", () => {
    expect(
      nextRangeSelection({ checkIn: d("2026-07-31"), checkOut: null }, d("2026-07-30"), free)
    ).toEqual({ checkIn: d("2026-07-30"), checkOut: null });
  });
  it("restarts on a later free day when the range would span a booked night", () => {
    // Aug 2 booked; from Jul 31 clicking Aug 3 would span Aug 2 → restart at Aug 3.
    expect(
      nextRangeSelection({ checkIn: d("2026-07-31"), checkOut: null }, d("2026-08-03"), blocks)
    ).toEqual({ checkIn: d("2026-08-03"), checkOut: null });
  });
  it("begins a new range when a full range already exists", () => {
    expect(
      nextRangeSelection(
        { checkIn: d("2026-07-10"), checkOut: d("2026-07-12") },
        d("2026-07-20"),
        free
      )
    ).toEqual({ checkIn: d("2026-07-20"), checkOut: null });
  });
});

describe("Airbnb iCal sync — imported blocks stay respected (exclusive DTEND)", () => {
  // Airbnb VEVENT DTSTART=Aug 2 DTEND=Aug 4 → nights Aug 2 & 3 occupied, checkout Aug 4.
  const ical = [{ startDate: d("2026-08-02"), endDate: d("2026-08-04") }];

  it("blocks check-in on imported occupied nights", () => {
    expect(isBlockedNight(d("2026-08-02"), ical)).toBe(true);
    expect(isBlockedNight(d("2026-08-03"), ical)).toBe(true);
    expect(
      nextRangeSelection({ checkIn: null, checkOut: null }, d("2026-08-03"), ical)
    ).toBeNull();
  });
  it("frees the imported checkout morning (exclusive end) for a new check-in", () => {
    expect(isBlockedNight(d("2026-08-04"), ical)).toBe(false);
    expect(
      nextRangeSelection({ checkIn: null, checkOut: null }, d("2026-08-04"), ical)
    ).toEqual({ checkIn: d("2026-08-04"), checkOut: null });
  });
  it("allows checkout onto the first imported night (same-day turnover)", () => {
    expect(isSelectableCheckout(d("2026-08-01"), d("2026-08-02"), ical)).toBe(true);
  });
  it("prevents booking straight across the imported block", () => {
    expect(isSelectableCheckout(d("2026-08-01"), d("2026-08-04"), ical)).toBe(false);
    expect(isRangeAvailable(d("2026-08-01"), d("2026-08-04"), ical)).toBe(false);
  });
});
