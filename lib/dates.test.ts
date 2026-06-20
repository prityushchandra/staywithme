import { describe, it, expect } from "vitest";
import { rangesOverlap, isRangeAvailable, toUtcDate } from "./dates";

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
