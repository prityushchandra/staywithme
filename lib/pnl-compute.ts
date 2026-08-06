import type { PnlListingMonth } from "./pnl";

// Pure P&L aggregation (no DB) so the admin page and the Excel export produce
// identical numbers. All money is in paise.

export interface PnlSummary {
  revenueDirect: number;
  revenueOffline: number;
  revenueOnline: number;
  revenueTotal: number;
  rent: number;
  staff: number;
  expenseTotal: number;
  profit: number;
  margin: number; // profit / revenue, as a percentage (0 when no revenue)
}

export function summarize(rows: PnlListingMonth[]): PnlSummary {
  let revenueDirect = 0;
  let revenueOffline = 0;
  let revenueOnline = 0;
  let rent = 0;
  let staff = 0;
  for (const r of rows) {
    revenueDirect += r.revenueDirect;
    revenueOffline += r.revenueOffline;
    revenueOnline += r.revenueOnline;
    rent += r.rent;
    staff += r.staff;
  }
  const revenueTotal = revenueDirect + revenueOffline + revenueOnline;
  const expenseTotal = rent + staff;
  const profit = revenueTotal - expenseTotal;
  const margin = revenueTotal > 0 ? (profit / revenueTotal) * 100 : 0;
  return { revenueDirect, revenueOffline, revenueOnline, revenueTotal, rent, staff, expenseTotal, profit, margin };
}

/** Rows in the given year, optionally narrowed to a single "YYYY-MM" month. */
export function filterScope(rows: PnlListingMonth[], year: number, month?: string): PnlListingMonth[] {
  return rows.filter((r) => r.year === year && (!month || r.month === month));
}

export interface PnlMonthly extends PnlSummary {
  month: string;
  label: string;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One summary row per month key (keeps a continuous axis even for empty months). */
export function monthlyBreakdown(rows: PnlListingMonth[], monthKeys: string[]): PnlMonthly[] {
  const byMonth = new Map<string, PnlListingMonth[]>();
  for (const r of rows) {
    const list = byMonth.get(r.month);
    if (list) list.push(r);
    else byMonth.set(r.month, [r]);
  }
  return monthKeys.map((month) => ({ month, label: monthLabel(month), ...summarize(byMonth.get(month) ?? []) }));
}

export interface PnlPerFlat extends PnlSummary {
  listingId: string;
  label: string;
}

export function perFlatBreakdown(rows: PnlListingMonth[]): PnlPerFlat[] {
  const byFlat = new Map<string, { label: string; rows: PnlListingMonth[] }>();
  for (const r of rows) {
    const e = byFlat.get(r.listingId) ?? { label: r.label, rows: [] };
    e.rows.push(r);
    byFlat.set(r.listingId, e);
  }
  return [...byFlat.entries()]
    .map(([listingId, { label, rows: rs }]) => ({ listingId, label, ...summarize(rs) }))
    .sort((a, b) => b.profit - a.profit);
}
