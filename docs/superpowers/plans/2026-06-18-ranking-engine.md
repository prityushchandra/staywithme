# Engagement Ranking Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order browse and search by an admin-configurable engagement score (views/clicks/saves) instead of newest-first.

**Architecture:** A pure scoring core (`lib/ranking.ts`, unit-tested like `lib/pricing.ts`) plus integration inside the already-cached public reads. Engagement counts come from the existing `getListingStats` (`AnalyticsEvent` groupBy); weights live in `PlatformSettings` and are admin-editable. No new infrastructure, no cron.

**Tech Stack:** Next.js 15 (App Router), Prisma 6 + Neon Postgres, Vitest, `unstable_cache`.

> **Note — not a git repo:** this workspace is not git-tracked, so the usual `git commit` after each task is replaced by a **Checkpoint** step (run the relevant test/build to confirm green). Keep changes small per task regardless.

> **Spec:** [docs/superpowers/specs/2026-06-18-ranking-engine-design.md](../specs/2026-06-18-ranking-engine-design.md)

---

## File Structure

- **Create** `lib/ranking.ts` — pure scoring + sorting (`RankWeights`, `EngagementStats`, `computeRankScore`, `rankListings`). No DB imports.
- **Create** `lib/ranking.test.ts` — unit tests for the two pure functions.
- **Modify** `prisma/schema.prisma` — 3 weight fields on `PlatformSettings`.
- **Modify** `lib/data-access.ts` — rank inside the cached published-listings read, page on the ranked result.
- **Modify** `lib/search.ts` — rank filtered search results.
- **Modify** `app/api/admin/settings/route.ts` — accept + persist weights, `revalidateTag("listings")`.
- **Modify** `components/admin/settings-form.tsx` — 3 weight inputs.
- **Modify** `app/admin/settings/page.tsx` — pass weights as initial values.

---

## Task 1: Add ranking weight fields to PlatformSettings

**Files:**
- Modify: `prisma/schema.prisma` (the `PlatformSettings` model)

- [ ] **Step 1: Add the three weight fields**

Find the `PlatformSettings` model and add these three lines alongside the existing fields (e.g. after `suggestedPriceMax`):

```prisma
  rankWeightView   Int @default(1)
  rankWeightSave   Int @default(3)
  rankWeightClick  Int @default(5)
```

- [ ] **Step 2: Push schema + regenerate client**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema." followed by "Generated Prisma Client". The existing singleton row gets the defaults (1/3/5).

- [ ] **Step 3: Checkpoint**

Run: `npx tsc --noEmit`
Expected: no errors (the new fields are now on the generated `PlatformSettings` type).

---

## Task 2: `computeRankScore` (pure, TDD)

**Files:**
- Create: `lib/ranking.ts`
- Create (test): `lib/ranking.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ranking.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run lib/ranking.test.ts`
Expected: FAIL — `computeRankScore` is not exported / file not found.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/ranking.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run lib/ranking.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Checkpoint**

Run: `npm test -- --run lib/ranking.test.ts`
Expected: all green.

---

## Task 3: `rankListings` (pure, TDD)

**Files:**
- Modify: `lib/ranking.ts`
- Modify (test): `lib/ranking.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/ranking.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run lib/ranking.test.ts`
Expected: FAIL — `rankListings` is not exported.

- [ ] **Step 3: Implement `rankListings`**

Append to `lib/ranking.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run lib/ranking.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Checkpoint**

Run: `npm test -- --run`
Expected: the whole suite (pricing/whatsapp/search/dates/reviews/ranking) is green.

---

## Task 4: Rank the cached browse reads

**Files:**
- Modify: `lib/data-access.ts`

- [ ] **Step 1: Add imports**

At the top of `lib/data-access.ts`, below the existing imports, add:

```ts
import { getListingStats } from "./analytics";
import { getPlatformSettings } from "./settings";
import { rankListings } from "./ranking";
```

- [ ] **Step 2: Replace the cached published-listings function and its wrapper**

Replace the existing `cachedPublishedListings` const and the `getPublishedListings` function with:

```ts
// Fetch the FULL published set, rank by engagement, and cache the ranked array.
// Ranking the whole set (not a pre-paged slice) is required so pagination pages
// the ranked order. Runs at most once per cache window (tags: ["listings"]).
const cachedRankedListings = unstable_cache(
  async (): Promise<PublicListing[]> => {
    const listings = await prisma.listing.findMany({
      where: { status: "PUBLISHED" },
      include: publicListingInclude,
      orderBy: { createdAt: "desc" },
    });
    const [stats, settings] = await Promise.all([
      getListingStats(listings.map((l) => l.id)),
      getPlatformSettings(),
    ]);
    return rankListings(listings, stats, {
      view: settings.rankWeightView,
      save: settings.rankWeightSave,
      click: settings.rankWeightClick,
    });
  },
  ["ranked-published-listings"],
  LISTINGS_CACHE
);

/** Fetch published listings for public browsing, engagement-ranked. */
export async function getPublishedListings(options?: {
  take?: number;
  skip?: number;
}): Promise<PublicListing[]> {
  const ranked = await cachedRankedListings();
  const skip = options?.skip ?? 0;
  return options?.take !== undefined
    ? ranked.slice(skip, skip + options.take)
    : ranked.slice(skip);
}
```

Leave `getFeaturedListings`, `getPublishedListingById`, and `getPublishedListingsByIds` unchanged — the Featured strip stays curated, per the spec.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`getListingStats` returns `Record<string, {views,whatsappClicks,saves}>`, structurally compatible with `rankListings`' `statsById`.)

- [ ] **Step 4: Checkpoint — build**

Run: `npm run build`
Expected: "Compiled successfully" and the route table prints (no type errors).

---

## Task 5: Rank search results

**Files:**
- Modify: `lib/search.ts`

- [ ] **Step 1: Add imports**

At the top of `lib/search.ts`, below the existing imports, add:

```ts
import { getListingStats } from "./analytics";
import { getPlatformSettings } from "./settings";
import { rankListings } from "./ranking";
```

- [ ] **Step 2: Replace `searchListings`**

Replace the existing `searchListings` function with:

```ts
export async function searchListings(
  params: SearchParams,
  platformFeePercent: number
): Promise<SearchResult[]> {
  // Pull a wider candidate set (newest-first), rank by engagement, then trim.
  const matches = await prisma.listing.findMany({
    where: buildListingWhere(params, platformFeePercent),
    include,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const [stats, settings] = await Promise.all([
    getListingStats(matches.map((l) => l.id)),
    getPlatformSettings(),
  ]);

  return rankListings(matches, stats, {
    view: settings.rankWeightView,
    save: settings.rankWeightSave,
    click: settings.rankWeightClick,
  }).slice(0, 60);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Checkpoint — build**

Run: `npm run build`
Expected: compiles cleanly.

---

## Task 6: Admin-editable weights

**Files:**
- Modify: `app/api/admin/settings/route.ts`
- Modify: `components/admin/settings-form.tsx`
- Modify: `app/admin/settings/page.tsx`

- [ ] **Step 1: Extend the settings API schema**

In `app/api/admin/settings/route.ts`, add three fields to the `schema` object (after `suggestedPriceMaxRupees`):

```ts
  rankWeightView: z.coerce.number().int().min(0).max(100),
  rankWeightSave: z.coerce.number().int().min(0).max(100),
  rankWeightClick: z.coerce.number().int().min(0).max(100),
```

- [ ] **Step 2: Persist the weights**

In the same file, add these three lines to **both** the `update` and `create` objects of the `prisma.platformSettings.upsert(...)` call:

```ts
      rankWeightView: d.rankWeightView,
      rankWeightSave: d.rankWeightSave,
      rankWeightClick: d.rankWeightClick,
```

- [ ] **Step 3: Invalidate the listings cache on save**

In the same file, the route already calls `revalidateTag("settings");`. Add a line directly after it so a weight change re-ranks browse immediately:

```ts
  revalidateTag("listings");
```

- [ ] **Step 4: Add the weight fields to the form type and initial state**

In `components/admin/settings-form.tsx`, extend the `initial` prop type (inside the `initial: { ... }` block) with:

```ts
    rankWeightView: number;
    rankWeightSave: number;
    rankWeightClick: number;
```

- [ ] **Step 5: Add the weight inputs to the form UI**

In `components/admin/settings-form.tsx`, insert this block immediately before the line `{error && <p className="text-sm text-destructive">{error}</p>}`:

```tsx
      <div className="space-y-1">
        <Label>Ranking weights</Label>
        <p className="text-xs text-muted-foreground">
          How much each engagement signal counts when ordering browse &amp; search.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="wView" className="text-xs">Per view</Label>
            <Input
              id="wView"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightView}
              onChange={(e) => set("rankWeightView", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wSave" className="text-xs">Per save</Label>
            <Input
              id="wSave"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightSave}
              onChange={(e) => set("rankWeightSave", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wClick" className="text-xs">Per WhatsApp click</Label>
            <Input
              id="wClick"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightClick}
              onChange={(e) => set("rankWeightClick", Number(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>
```

- [ ] **Step 6: Pass the weights from the settings page**

In `app/admin/settings/page.tsx`, add these three lines inside the `initial={{ ... }}` object (after `suggestedPriceMaxRupees`):

```ts
          rankWeightView: settings.rankWeightView,
          rankWeightSave: settings.rankWeightSave,
          rankWeightClick: settings.rankWeightClick,
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run build`
Expected: compiles cleanly; `/admin/settings` and `/api/admin/settings` still present in the route table.

- [ ] **Step 8: Checkpoint**

Run: `npm test -- --run`
Expected: full suite green.

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test -- --run`
Expected: all suites pass, including `lib/ranking.test.ts` (4 tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: "Compiled successfully", no type errors.

- [ ] **Step 3: Manual end-to-end (dev or prod server)**

Start the app (`npm run dev` or `npm start`) and verify:
- The homepage "Stays you'll love" grid is ordered by engagement (a listing with WhatsApp clicks/saves appears above a newer listing with only views). The seed gives the first two listings reviews/engagement; click the WhatsApp button a few times on one listing, wait ~60s (cache window) or change a weight to force re-rank, and confirm it climbs.
- Sign in as admin → **Settings** → set "Per WhatsApp click" to a high number, "Per view" to 0 → Save → reload homepage → high-click listings jump to the top (cache invalidated immediately via `revalidateTag("listings")`).
- A brand-new listing (create one as host, approve as admin) still appears in browse (tie-break), not missing.
- `/search` results reflect the same ordering.

- [ ] **Step 4: Confirm no regressions**

Verify the Featured strip on the homepage is unchanged (still curated/newest), and listing cards still show ratings and prices correctly.

---

## Self-Review (completed by plan author)

- **Spec coverage:** schema weights (Task 1) ✓; pure scoring core (Tasks 2–3) ✓; browse integration with whole-set ranking + paging (Task 4) ✓; search integration (Task 5) ✓; admin-configurable weights + `revalidateTag("listings")` (Task 6) ✓; tie-break newest-first (Task 3) ✓; featured strip untouched (Task 4 note) ✓; unit tests + verification (Tasks 2,3,7) ✓.
- **Type consistency:** `RankWeights {view,save,click}`, `EngagementStats {views,whatsappClicks,saves}`, `computeRankScore`, `rankListings` used identically across Tasks 2–6. Weight object built the same way (`{view,save,click}`) in Tasks 4 and 5.
- **No placeholders:** every code step shows full code; commands have expected output.
