import { monthKeyOf, todayInIndia } from "@/lib/pnl-compute";

/** Reporting and visibility changes roll over at midnight in India. */
export function currentPnlMonth(now = new Date()): string {
  return monthKeyOf(todayInIndia(now));
}

export function visibilityMonthUpsert(listingId: string, isVisible: boolean, now = new Date()) {
  const month = currentPnlMonth(now);
  return {
    upsert: {
      where: { listingId_month: { listingId, month } },
      create: { month, isVisible },
      update: { isVisible },
    },
  };
}

interface ListingVisibility {
  status: string;
  isVisible: boolean;
  visibilityMonths: { month: string; isVisible: boolean }[];
}

export function isListedForPnlMonth(
  listing: ListingVisibility,
  month: string,
  currentMonth: string
): boolean {
  if (month >= currentMonth) return listing.status === "PUBLISHED" && listing.isVisible;

  // Before tracking began, retain the legacy report's inclusion of every flat.
  // Later gaps inherit the last saved state, not the listing's live visibility.
  let isVisible = true;
  let lastMonth = "";
  for (const entry of listing.visibilityMonths) {
    if (entry.month <= month && entry.month > lastMonth) {
      lastMonth = entry.month;
      isVisible = entry.isVisible;
    }
  }
  return isVisible;
}
