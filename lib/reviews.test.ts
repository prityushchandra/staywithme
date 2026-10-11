import { describe, it, expect } from "vitest";
import { computeRatingSummary, resolveReviewDate, reviewDisplayName } from "./reviews";

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

describe("reviewDisplayName", () => {  it("uses the admin-entered name when the review has no account", () => {
    expect(reviewDisplayName({ authorName: "Ananya S.", author: null })).toBe("Ananya S.");
  });

  it("prefers the admin-entered name over the account name", () => {
    expect(
      reviewDisplayName({ authorName: "Ravi K.", author: { name: "Ravi Kumar" } })
    ).toBe("Ravi K.");
  });

  it("falls back to the account name, then to Guest", () => {
    expect(reviewDisplayName({ authorName: null, author: { name: "Meera" } })).toBe("Meera");
    expect(reviewDisplayName({ authorName: null, author: { name: null } })).toBe("Guest");
    expect(reviewDisplayName({ authorName: "   ", author: null })).toBe("Guest");
  });
});

describe("resolveReviewDate", () => {
  const now = new Date("2026-03-10T09:00:00.000Z");

  it("anchors a past date at midday UTC so it stays on that day in IST", () => {
    expect(resolveReviewDate("2025-11-02", now).toISOString()).toBe(
      "2025-11-02T12:00:00.000Z"
    );
  });

  it("clamps a pick that would land in the future to now", () => {
    // Midday on 10 Mar is still ahead of 09:00, so it must not sort as newest.
    expect(resolveReviewDate("2026-03-10", now)).toEqual(now);
    expect(resolveReviewDate("2027-01-01", now)).toEqual(now);
  });

  it("falls back to now when the date is missing or unparseable", () => {
    expect(resolveReviewDate(undefined, now)).toEqual(now);
    expect(resolveReviewDate("not-a-date", now)).toEqual(now);
  });
});
