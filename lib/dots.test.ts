import { describe, it, expect } from "vitest";
import { cleanDays, dayStatuses, daysInMonth, isValidMonth, monthStartMs } from "./dots";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const blk = (from: string, to: string, kind: string) => ({
  startDate: utc(from),
  endDate: utc(to),
  kind,
});
const soldRange = (from: string, to: string) => {
  const out = new Set<number>();
  for (let t = utc(from).getTime(); t < utc(to).getTime(); t += 86_400_000) out.add(t);
  return out;
};

describe("month helpers", () => {
  it("knows how long each month is", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29); // leap year
    expect(daysInMonth("2026-08")).toBe(31);
    expect(daysInMonth("2026-09")).toBe(30);
  });

  it("starts a month at UTC midnight on the 1st", () => {
    expect(monthStartMs("2026-08")).toBe(Date.UTC(2026, 7, 1));
  });

  it("rejects nonsense months", () => {
    expect(isValidMonth("2026-08")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("26-08")).toBe(false);
    expect(isValidMonth("")).toBe(false);
  });
});

describe("cleanDays", () => {
  it("drops days that don't exist in the month", () => {
    expect(cleanDays([0, 1, 29, 30, 31, 32], "2026-02")).toEqual([1]);
    expect(cleanDays([1, 31], "2026-08")).toEqual([1, 31]);
  });

  it("dedupes and sorts", () => {
    expect(cleanDays([5, 1, 5, 3], "2026-08")).toEqual([1, 3, 5]);
  });

  it("drops non-integers", () => {
    expect(cleanDays([1.5, 2, NaN], "2026-08")).toEqual([2]);
  });

  it("drops days that haven't ended when given today", () => {
    const today = Date.UTC(2026, 7, 25); // 25 Aug 2026
    expect(cleanDays([23, 24, 25, 26, 31], "2026-08", today)).toEqual([23, 24]);
  });

  it("keeps a whole past month when given today", () => {
    const today = Date.UTC(2026, 7, 25);
    expect(cleanDays([1, 15, 31], "2026-07", today)).toEqual([1, 15, 31]);
  });

  it("drops a whole future month when given today", () => {
    const today = Date.UTC(2026, 7, 25);
    expect(cleanDays([1, 15, 30], "2026-09", today)).toEqual([]);
  });
});

describe("dayStatuses", () => {
  const today = Date.UTC(2026, 7, 25); // 25 Aug 2026
  const live = Date.UTC(2026, 6, 23); // flat went live 23 Jul 2026
  const none = new Set<number>();
  const on = (month: string, opts?: Partial<{ blocks: ReturnType<typeof blk>[]; sold: Set<number>; liveFrom: number }>) =>
    dayStatuses(month, opts?.liveFrom ?? live, opts?.blocks ?? [], opts?.sold ?? none, today);

  it("gives one entry per day of the month", () => {
    expect(on("2026-08")).toHaveLength(31);
    expect(on("2026-09")).toHaveLength(30);
  });

  it("marks elapsed unsold days as open — the only ones that can be dots", () => {
    const s = on("2026-08");
    expect(s[0]).toBe("open"); // 1 Aug
    expect(s[23]).toBe("open"); // 24 Aug
  });

  it("treats today and later as still to come, not lost", () => {
    const s = on("2026-08");
    expect(s[24]).toBe("upcoming"); // 25 Aug — today
    expect(s[30]).toBe("upcoming"); // 31 Aug
    expect(on("2026-09").every((x) => x === "upcoming")).toBe(true);
  });

  it("marks booked days as sold, past or future", () => {
    const s = on("2026-08", { sold: soldRange("2026-08-10", "2026-08-12") });
    expect(s[9]).toBe("sold");
    expect(s[10]).toBe("sold");
    expect(s[11]).toBe("open"); // check-out day is not a night
  });

  it("keeps a future booking visible as sold rather than upcoming", () => {
    const s = on("2026-08", { sold: soldRange("2026-08-27", "2026-08-29") });
    expect(s[26]).toBe("sold");
    expect(s[28]).toBe("upcoming");
  });

  it("marks days the host blocked by hand as off-market", () => {
    const s = on("2026-08", { blocks: [blk("2026-08-05", "2026-08-08", "MANUAL")] });
    expect(s[4]).toBe("offMarket");
    expect(s[6]).toBe("offMarket");
    expect(s[7]).toBe("open");
  });

  it("does NOT let an Airbnb block hide an unsold day", () => {
    // Airbnb shuts a date off once it can no longer be sold, so an ICAL block on
    // a past date proves nothing about whether it earned anything.
    const s = on("2026-08", { blocks: [blk("2026-08-01", "2026-08-10", "ICAL")] });
    expect(s.slice(0, 9).every((x) => x === "open")).toBe(true);
  });

  it("prefers sold over off-market when the host blocked a direct sale", () => {
    const s = on("2026-08", {
      blocks: [blk("2026-08-05", "2026-08-08", "MANUAL")],
      sold: soldRange("2026-08-05", "2026-08-08"),
    });
    expect(s.slice(4, 7).every((x) => x === "sold")).toBe(true);
  });

  it("marks days before the flat existed", () => {
    const s = on("2026-07");
    expect(s[0]).toBe("preLive"); // 1 Jul
    expect(s[21]).toBe("preLive"); // 22 Jul
    expect(s[22]).toBe("open"); // 23 Jul — went live
    expect(s.filter((x) => x === "open")).toHaveLength(9); // 23..31 Jul
  });

  it("marks a whole month before the flat existed", () => {
    expect(on("2026-06").every((x) => x === "preLive")).toBe(true);
  });
});
