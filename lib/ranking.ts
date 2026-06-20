// Ranking — pure engagement scoring + sorting. NO database imports, so it stays
// unit-testable like lib/pricing.ts. The DB-backed integration lives in
// lib/data-access.ts and lib/search.ts, which feed this module the stats.

export interface RankWeights {
  view: number;
  save: number;
  click: number;
}

// Structurally identical to ListingStats in lib/analytics.ts; kept local so this
// module pulls in no Prisma/runtime dependency.
export interface EngagementStats {
  views: number;
  whatsappClicks: number;
  saves: number;
}

/** Weighted engagement score for one listing. Higher ranks higher. */
export function computeRankScore(
  stats: EngagementStats,
  weights: RankWeights
): number {
  return (
    stats.views * weights.view +
    stats.whatsappClicks * weights.click +
    stats.saves * weights.save
  );
}

const ZERO: EngagementStats = { views: 0, whatsappClicks: 0, saves: 0 };

/**
 * Return a sorted copy of `listings`, highest engagement score first. Equal
 * scores (including brand-new zero-engagement listings) tie-break by newest
 * createdAt, so nothing is buried. Pure — never touches the database.
 */
export function rankListings<T extends { id: string; createdAt: Date }>(
  listings: T[],
  statsById: Record<string, EngagementStats>,
  weights: RankWeights
): T[] {
  return [...listings].sort((a, b) => {
    const scoreA = computeRankScore(statsById[a.id] ?? ZERO, weights);
    const scoreB = computeRankScore(statsById[b.id] ?? ZERO, weights);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
