import { describe, it, expect } from "vitest";
import { computeRatingSummary } from "./reviews";

describe("computeRatingSummary", () => {
  it("returns zeroed summary for no ratings", () => {
    expect(computeRatingSummary([])).toEqual({ average: 0, count: 0 });
  });

  it("uses the rating itself for a single review", () => {
    expect(computeRatingSummary([4])).toEqual({ average: 4, count: 1 });
  });

  it("averages multiple ratings and counts them", () => {
    expect(computeRatingSummary([5, 4, 3])).toEqual({ average: 4, count: 3 });
  });

  it("rounds the average to one decimal place", () => {
    // (5 + 4) / 2 = 4.5
    expect(computeRatingSummary([5, 4])).toEqual({ average: 4.5, count: 2 });
    // (5 + 4 + 4) / 3 = 4.333... -> 4.3
    expect(computeRatingSummary([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
    // (5 + 5 + 4) / 3 = 4.666... -> 4.7
    expect(computeRatingSummary([5, 5, 4])).toEqual({ average: 4.7, count: 3 });
  });
});
