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

  it("rounds the average to two decimal places", () => {
    // (5 + 4) / 2 = 4.5
    expect(computeRatingSummary([5, 4])).toEqual({ average: 4.5, count: 2 });
    // (5 + 4 + 4) / 3 = 4.333... -> 4.33
    expect(computeRatingSummary([5, 4, 4])).toEqual({ average: 4.33, count: 3 });
    // (5 + 5 + 4) / 3 = 4.666... -> 4.67
    expect(computeRatingSummary([5, 5, 4])).toEqual({ average: 4.67, count: 3 });
  });

  it("keeps a 97x5 + 3x4 listing at exactly 4.97 instead of rounding to 5", () => {
    const ratings = [...Array(97).fill(5), ...Array(3).fill(4)];
    expect(computeRatingSummary(ratings)).toEqual({ average: 4.97, count: 100 });
  });
});
