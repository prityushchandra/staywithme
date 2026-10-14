import { describe, it, expect } from "vitest";
import type { PnlListingMonth } from "./pnl";
import {
  financialYearStart,
  financialYearLabel,
  financialYearsFromMonths,
  monthsOfFinancialYear,
  filterFinancialYear,
  sourceRevenue,
  sourceNights,
  avgPerDay,
  stayNights,
  eachNight,
  splitStayByMonth,
  icalNightsByMonth,
  countAvailableDays,
  todayInIndia,
  scopeSummary,
  summarize,
  perFlatBreakdown,
  emptyExpenseByType,
  allocateStaffPay,
} from "./pnl-compute";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const monthStart = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
};

function row(
  partial: Partial<PnlListingMonth> & { listingId: string; month: string; rent?: number }
): PnlListingMonth {
  const [y, m] = partial.month.split("-").map(Number);
  const expenseByType = partial.expenseByType ?? emptyExpenseByType();
  if (partial.rent) expenseByType.RENT += partial.rent;
  return {
    listingId: partial.listingId,
    label: partial.label ?? partial.listingId,
    month: partial.month,
    year: y,
    monthIndex: m - 1,
    revenueDirect: partial.revenueDirect ?? 0,
    revenueOffline: partial.revenueOffline ?? 0,
    revenueOnline: partial.revenueOnline ?? 0,
    nightsDirect: partial.nightsDirect ?? 0,
    nightsOffline: partial.nightsOffline ?? 0,
    nightsOnline: partial.nightsOnline ?? 0,
    expenseByType,
    setup: partial.setup ?? 0,
    staff: partial.staff ?? 0,
    unbookedDays: partial.unbookedDays ?? 0,
    dots: partial.dots ?? 0,
  };
}

describe("financial year helpers", () => {
  it("maps a month to its FY start year (Apr–Mar)", () => {
    expect(financialYearStart("2026-04")).toBe(2026);
    expect(financialYearStart("2026-12")).toBe(2026);
    expect(financialYearStart("2027-01")).toBe(2026);
    expect(financialYearStart("2026-03")).toBe(2025);
  });

  it("labels a FY like FY 2026-27", () => {
    expect(financialYearLabel(2026)).toBe("FY 2026-27");
    expect(financialYearLabel(1999)).toBe("FY 1999-00");
  });

  it("lists 12 FY months in Apr..Mar order", () => {
    const m = monthsOfFinancialYear(2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2026-04");
    expect(m[11]).toBe("2027-03");
  });

  it("derives the distinct FYs present in a set of months", () => {
    expect(financialYearsFromMonths(["2026-03", "2026-04", "2027-01", "2027-05"])).toEqual([2025, 2026, 2027]);
  });

  it("filters rows to a FY and optional month", () => {
    const rows = [
      row({ listingId: "a", month: "2026-03" }), // FY2025
      row({ listingId: "a", month: "2026-04" }), // FY2026
      row({ listingId: "b", month: "2027-02" }), // FY2026
    ];
    expect(filterFinancialYear(rows, 2026)).toHaveLength(2);
    expect(filterFinancialYear(rows, 2025)).toHaveLength(1);
    expect(filterFinancialYear(rows, 2026, "2027-02")).toHaveLength(1);
  });
});

describe("source-scoped revenue", () => {
  const s = { revenueOnline: 1000, revenueOffline: 400, revenueDirect: 100 };
  it("returns the right bucket per source", () => {
    expect(sourceRevenue(s, "online")).toBe(1000);
    expect(sourceRevenue(s, "offline")).toBe(500); // offline + direct
    expect(sourceRevenue(s, "both")).toBe(1500);
  });

  it("scopes profit and margin against fixed expenses", () => {
    const total = summarize([
      row({ listingId: "a", month: "2026-05", revenueOnline: 1000, revenueOffline: 400, revenueDirect: 100, rent: 300, staff: 200 }),
    ]);
    expect(total.expenseTotal).toBe(500);
    const online = scopeSummary(total, "online");
    expect(online.revenue).toBe(1000);
    expect(online.profit).toBe(500);
    expect(online.margin).toBeCloseTo(50, 5);
    const offline = scopeSummary(total, "offline");
    expect(offline.revenue).toBe(500);
    expect(offline.profit).toBe(0);
    expect(offline.margin).toBeCloseTo(0, 5);
  });
});

describe("summarize", () => {
  it("aggregates revenue, expenses, and unbooked days", () => {
    const t = summarize([
      row({ listingId: "a", month: "2026-05", revenueOnline: 500, rent: 100, staff: 50, unbookedDays: 3 }),
      row({ listingId: "a", month: "2026-06", revenueOffline: 200, unbookedDays: 5 }),
    ]);
    expect(t.revenueTotal).toBe(700);
    expect(t.expenseTotal).toBe(150);
    expect(t.profit).toBe(550);
    expect(t.unbookedDays).toBe(8);
  });

  it("reports setup spend but keeps it out of expenses and profit", () => {
    // A one-off fit-out earns across every month that follows, so charging it to
    // the month it was paid would show a loss the business never made.
    const t = summarize([
      row({ listingId: "a", month: "2026-05", revenueOnline: 500, rent: 100, staff: 50, setup: 900 }),
    ]);
    expect(t.setup).toBe(900);
    expect(t.expenseTotal).toBe(150);
    expect(t.profit).toBe(350);
  });

  it("aggregates booked nights per channel", () => {    const t = summarize([
      row({ listingId: "a", month: "2026-05", nightsOnline: 4, nightsOffline: 2, nightsDirect: 1 }),
      row({ listingId: "a", month: "2026-06", nightsOnline: 3 }),
    ]);
    expect(t.nightsOnline).toBe(7);
    expect(t.nightsOffline).toBe(2);
    expect(t.nightsDirect).toBe(1);
    expect(t.nightsTotal).toBe(10);
  });
});

describe("allocateStaffPay", () => {
  it("splits pay evenly across the flats it covers", () => {
    const got = allocateStaffPay(900_000, ["a", "b", "c"]);
    expect([...got.values()]).toEqual([300_000, 300_000, 300_000]);
  });

  it("never loses paise to rounding, so the P&L total matches payroll", () => {
    // 8,900 rupees over 6 flats doesn't divide cleanly; rounding each share on
    // its own would shed paise and leave P&L disagreeing with the payroll page.
    const pay = 890_000;
    const ids = ["a", "b", "c", "d", "e", "f"];
    const got = allocateStaffPay(pay, ids);
    expect([...got.values()].reduce((s, n) => s + n, 0)).toBe(pay);
    expect(got.size).toBe(6);
  });

  it("charges a single flat the whole salary", () => {
    expect([...allocateStaffPay(123_457, ["only"]).values()]).toEqual([123_457]);
  });

  it("yields nothing when there are no flats to charge", () => {
    expect(allocateStaffPay(500, []).size).toBe(0);
  });

  it("feeds summarize so staff pay lands in expenses and profit", () => {
    // The bug this guards: staff pay was read from a table nothing writes, so
    // every month reported a profit that ignored the cleaner's salary.
    const alloc = allocateStaffPay(890_000, ["a", "b"]);
    const t = summarize(
      [...alloc].map(([listingId, staff]) => row({ listingId, month: "2026-08", revenueOnline: 1_000_000, staff }))
    );
    expect(t.staff).toBe(890_000);
    expect(t.expenseTotal).toBe(890_000);
    expect(t.profit).toBe(2_000_000 - 890_000);
  });
});

describe("average per booked day", () => {
  const r = row({
    listingId: "a",
    month: "2026-05",
    revenueOnline: 40_000, // ₹400 over 4 nights  → ₹100/night
    revenueOffline: 18_000,
    revenueDirect: 6_000, // ₹240 over 3 nights   → ₹80/night
    nightsOnline: 4,
    nightsOffline: 2,
    nightsDirect: 1,
  });

  it("sums nights for the chosen channel", () => {
    expect(sourceNights(r, "online")).toBe(4);
    expect(sourceNights(r, "offline")).toBe(3); // offline + direct
    expect(sourceNights(r, "both")).toBe(7);
  });

  it("divides channel revenue by that channel's booked nights", () => {
    expect(avgPerDay(r, "online")).toBe(10_000);
    expect(avgPerDay(r, "offline")).toBe(8_000);
    expect(avgPerDay(r, "both")).toBe(Math.round(64_000 / 7));
  });

  it("returns null rather than 0 when nothing was booked", () => {
    // Revenue with no nights (e.g. an Airbnb payout with no calendar synced)
    // has no meaningful average — 0 would read as "earned nothing".
    const noNights = row({ listingId: "b", month: "2026-05", revenueOnline: 50_000 });
    expect(avgPerDay(noNights, "online")).toBeNull();
    expect(avgPerDay(noNights, "both")).toBeNull();
  });

  it("is a weighted average across flats, not an average of averages", () => {
    const rows = [
      row({ listingId: "a", month: "2026-05", revenueOffline: 30_000, nightsOffline: 10 }), // ₹30/night
      row({ listingId: "b", month: "2026-05", revenueOffline: 20_000, nightsOffline: 2 }), // ₹100/night
    ];
    const t = summarize(rows);
    // 50_000 / 12, not (30_000/10 + 20_000/2) / 2.
    expect(avgPerDay(t, "offline")).toBe(Math.round(50_000 / 12));
  });

  it("exposes nights and the daily rate on a scoped summary", () => {
    const scoped = scopeSummary(summarize([r]), "online");
    expect(scoped.nights).toBe(4);
    expect(scoped.avgPerDay).toBe(10_000);
  });

  it("carries nights through the per-flat breakdown", () => {
    const flats = perFlatBreakdown([
      row({ listingId: "a", label: "A-101", month: "2026-05", revenueOffline: 30_000, nightsOffline: 3 }),
      row({ listingId: "a", label: "A-101", month: "2026-06", revenueOffline: 10_000, nightsOffline: 1 }),
    ]);
    expect(flats).toHaveLength(1);
    expect(sourceNights(flats[0], "offline")).toBe(4);
    expect(avgPerDay(flats[0], "offline")).toBe(10_000);
  });
});

describe("stayNights", () => {
  it("counts nights, not calendar days touched", () => {
    expect(stayNights(utc("2026-05-01"), utc("2026-05-04"))).toBe(3);
  });

  it("ignores the time of day on check-in/check-out", () => {
    expect(stayNights(new Date("2026-05-01T18:30:00Z"), new Date("2026-05-04T05:00:00Z"))).toBe(3);
  });

  it("counts a same-day or malformed stay as one booked day", () => {
    // A 0 here would fold revenue into the daily rate with nothing to divide by.
    expect(stayNights(utc("2026-05-01"), utc("2026-05-01"))).toBe(1);
    expect(stayNights(utc("2026-05-04"), utc("2026-05-01"))).toBe(1);
  });

  it("spans month and year boundaries", () => {
    expect(stayNights(utc("2025-12-30"), utc("2026-01-02"))).toBe(3);
  });
});

describe("eachNight", () => {
  it("yields the occupied nights, excluding the check-out day", () => {
    expect(eachNight(utc("2026-05-01"), utc("2026-05-04"))).toEqual([
      utc("2026-05-01").getTime(),
      utc("2026-05-02").getTime(),
      utc("2026-05-03").getTime(),
    ]);
  });

  it("yields nothing for a same-day stay so back-to-back stays never collide", () => {
    expect(eachNight(utc("2026-05-01"), utc("2026-05-01"))).toEqual([]);
  });
});

describe("icalNightsByMonth", () => {
  const win = { from: monthStart("2026-05"), to: monthStart("2026-07") };

  it("attributes nights to the month they actually fall in", () => {
    const got = icalNightsByMonth(
      [{ startDate: utc("2026-05-30"), endDate: utc("2026-06-03") }],
      new Set(),
      win.from,
      win.to
    );
    // Revenue arrives as a monthly lump sum, so nights must split by calendar
    // month too — not pile onto the check-in month.
    expect(Object.fromEntries(got)).toEqual({ "2026-05": 2, "2026-06": 2 });
  });

  it("skips nights already covered by a booking we hold a record for", () => {
    const recorded = new Set(eachNight(utc("2026-05-10"), utc("2026-05-13")));
    const got = icalNightsByMonth(
      [{ startDate: utc("2026-05-10"), endDate: utc("2026-05-15") }],
      recorded,
      win.from,
      win.to
    );
    // The same Airbnb stay entered by hand AND imported over iCal must count once.
    expect(got.get("2026-05")).toBe(2);
  });

  it("drops a fully duplicated stay entirely", () => {
    const recorded = new Set(eachNight(utc("2026-05-10"), utc("2026-05-15")));
    const got = icalNightsByMonth(
      [{ startDate: utc("2026-05-10"), endDate: utc("2026-05-15") }],
      recorded,
      win.from,
      win.to
    );
    expect(got.size).toBe(0);
  });

  it("clamps stays that overhang the reporting window", () => {
    const got = icalNightsByMonth(
      [{ startDate: utc("2026-04-28"), endDate: utc("2026-05-03") }],
      new Set(),
      win.from,
      win.to
    );
    expect(Object.fromEntries(got)).toEqual({ "2026-05": 2 });
  });

  it("ignores stays entirely outside the window", () => {
    const got = icalNightsByMonth(
      [
        { startDate: utc("2026-03-01"), endDate: utc("2026-03-05") },
        { startDate: utc("2026-08-01"), endDate: utc("2026-08-05") },
      ],
      new Set(),
      win.from,
      win.to
    );
    expect(got.size).toBe(0);
  });

  it("accumulates across several stays in the same month", () => {
    const got = icalNightsByMonth(
      [
        { startDate: utc("2026-05-01"), endDate: utc("2026-05-04") },
        { startDate: utc("2026-05-20"), endDate: utc("2026-05-22") },
      ],
      new Set(),
      win.from,
      win.to
    );
    expect(got.get("2026-05")).toBe(5);
  });
});
describe("countAvailableDays", () => {
  const today = Date.UTC(2026, 7, 25); // 25 Aug 2026
  const blk = (from: string, to: string, kind: string) => ({
    startDate: utc(from),
    endDate: utc(to),
    kind,
  });

  it("counts available days from today onward only", () => {
    expect(countAvailableDays("2026-08", [], today)).toBe(7); // 25..31 Aug
  });

  it("has nothing available in a month already gone", () => {
    expect(countAvailableDays("2026-07", [], today)).toBe(0);
  });

  it("counts a whole month still to come", () => {
    expect(countAvailableDays("2026-09", [], today)).toBe(30);
  });

  it("does not count blocked days as available", () => {
    expect(countAvailableDays("2026-09", [blk("2026-09-01", "2026-09-06", "ICAL")], today)).toBe(25);
  });


  it("sums dots into the summary", () => {
    const s = summarize([
      row({ listingId: "a", month: "2026-08", dots: 3, unbookedDays: 2 }),
      row({ listingId: "b", month: "2026-08", dots: 4, unbookedDays: 1 }),
    ]);
    expect(s.dots).toBe(7);
    expect(s.unbookedDays).toBe(3);
  });
});

describe("todayInIndia", () => {
  const d = (iso: string) => todayInIndia(new Date(iso));
  const day = (y: number, m: number, dd: number) => Date.UTC(y, m - 1, dd);

  it("uses the India date during Indian working hours", () => {
    expect(d("2026-08-25T09:47:00.000Z")).toBe(day(2026, 8, 25)); // 15:17 IST
  });

  it("still calls it today at 11:55pm India time", () => {
    // The moment the host's rule checks: the day is not lost yet.
    expect(d("2026-08-25T18:25:00.000Z")).toBe(day(2026, 8, 25)); // 23:55 IST
  });

  it("rolls over the instant midnight passes in India", () => {
    expect(d("2026-08-25T18:29:59.000Z")).toBe(day(2026, 8, 25)); // 23:59:59 IST
    expect(d("2026-08-25T18:30:00.000Z")).toBe(day(2026, 8, 26)); // 00:00 IST
  });

  it("does not wait for UTC midnight to roll over", () => {
    // 01:30 IST on the 26th — UTC still says the 25th, India does not.
    expect(d("2026-08-25T20:00:00.000Z")).toBe(day(2026, 8, 26));
  });

  it("rolls the month and year over correctly", () => {
    expect(d("2026-08-31T18:30:00.000Z")).toBe(day(2026, 9, 1));
    expect(d("2026-12-31T18:30:00.000Z")).toBe(day(2027, 1, 1));
  });
});

describe("splitting a stay across months", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const split = (from: string, to: string, total: number) =>
    [...splitStayByMonth(d(from), d(to), total)].map(([m, p]) => [m, p.nights, p.amount]);

  it("leaves a stay inside one month alone", () => {
    expect(split("2026-09-10", "2026-09-15", 50_000)).toEqual([["2026-09", 5, 50_000]]);
  });

  it("splits 26 Sep -> 31 Oct across both months, pro rata by night", () => {
    // Nights 26-30 Sep are September's five; the other 30 belong to October.
    const parts = split("2026-09-26", "2026-10-31", 350_000);
    expect(parts).toEqual([
      ["2026-09", 5, 50_000],
      ["2026-10", 30, 300_000],
    ]);
  });

  it("gives the checkout month nothing when the guest leaves on the 1st", () => {
    // Checkout day is not a night, so a 29 Aug -> 1 Sep stay is entirely August.
    expect(split("2026-08-29", "2026-09-01", 9_000)).toEqual([["2026-08", 3, 9_000]]);
  });

  it("spans three months", () => {
    const parts = split("2026-08-30", "2026-10-02", 3_300);
    expect(parts.map(([m]) => m)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(parts.map(([, n]) => n)).toEqual([2, 30, 1]);
  });

  it("always adds back up to the total exactly", () => {
    for (const total of [1, 7, 999, 100_001, 123_457]) {
      const parts = split("2026-09-26", "2026-10-31", total);
      const sum = parts.reduce((a, [, , amount]) => a + (amount as number), 0);
      expect(sum).toBe(total);
    }
  });

  it("never loses a paise at a boundary, over any span", () => {
    const total = 1_000_003;
    for (let len = 1; len <= 70; len++) {
      const end = new Date(d("2026-09-20").getTime() + len * 86_400_000);
      const parts = [...splitStayByMonth(d("2026-09-20"), end, total)];
      const sum = parts.reduce((a, [, p]) => a + p.amount, 0);
      const nights = parts.reduce((a, [, p]) => a + p.nights, 0);
      expect(sum).toBe(total);
      expect(nights).toBe(len);
    }
  });

  it("splits nights the same way stayNights counts them", () => {
    const parts = splitStayByMonth(d("2026-09-26"), d("2026-10-31"), 0);
    const nights = [...parts.values()].reduce((a, p) => a + p.nights, 0);
    expect(nights).toBe(stayNights(d("2026-09-26"), d("2026-10-31")));
  });

  it("treats a same-day booking as one night in the check-in month", () => {
    expect(split("2026-09-26", "2026-09-26", 4_000)).toEqual([["2026-09", 1, 4_000]]);
  });

  it("carries a zero total without inventing money", () => {
    expect(split("2026-09-26", "2026-10-31", 0)).toEqual([
      ["2026-09", 5, 0],
      ["2026-10", 30, 0],
    ]);
  });
});
