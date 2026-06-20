import { describe, it, expect } from "vitest";
import { computeRankScore } from "./ranking";

const weights = { view: 1, save: 3, click: 5 };

describe("computeRankScore", () => {
  it("weights views, clicks and saves", () => {
    // 10*1 + 2*5 + 3*3 = 29
    expect(
      computeRankScore({ views: 10, whatsappClicks: 2, saves: 3 }, weights)
    ).toBe(29);
  });

  it("is zero with no engagement", () => {
    expect(
      computeRankScore({ views: 0, whatsappClicks: 0, saves: 0 }, weights)
    ).toBe(0);
  });
});

import { rankListings } from "./ranking";

describe("rankListings", () => {
  it("orders by score desc, tie-breaks by newest createdAt", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");
    const a = { id: "a", createdAt: newer }; // 0 engagement, newer
    const b = { id: "b", createdAt: older }; // 4 clicks -> score 20
    const c = { id: "c", createdAt: older }; // 0 engagement, older
    const stats = {
      a: { views: 0, whatsappClicks: 0, saves: 0 },
      b: { views: 0, whatsappClicks: 4, saves: 0 },
      c: { views: 0, whatsappClicks: 0, saves: 0 },
    };

    const ranked = rankListings([a, b, c], stats, { view: 1, save: 3, click: 5 });
    expect(ranked.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("treats a missing stats entry as zero engagement", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const ranked = rankListings(
      [{ id: "x", createdAt: d }],
      {},
      { view: 1, save: 3, click: 5 }
    );
    expect(ranked.map((l) => l.id)).toEqual(["x"]);
  });
});
