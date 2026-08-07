import { describe, it, expect } from "vitest";
import type { PnlListingMonth } from "./pnl";
import {
  financialYearStart,
  financialYearLabel,
  financialYearsFromMonths,
  monthsOfFinancialYear,
  filterFinancialYear,
  sourceRevenue,
  scopeSummary,
  summarize,
} from "./pnl-compute";

function row(partial: Partial<PnlListingMonth> & { listingId: string; month: string }): PnlListingMonth {
  const [y, m] = partial.month.split("-").map(Number);
  return {
    listingId: partial.listingId,
    label: partial.label ?? partial.listingId,
    month: partial.month,
    year: y,
    monthIndex: m - 1,
    revenueDirect: partial.revenueDirect ?? 0,
    revenueOffline: partial.revenueOffline ?? 0,
    revenueOnline: partial.revenueOnline ?? 0,
    rent: partial.rent ?? 0,
    staff: partial.staff ?? 0,
    unbookedDays: partial.unbookedDays ?? 0,
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
});
