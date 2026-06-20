# MyBnB — Sub-project #6a: Engagement Ranking Engine

**Date:** 2026-06-18
**Status:** Approved (design)
**Part of:** Sub-project #6 — Ranking, Analytics, Personalization & Anti-Gaming

---

## 1. Context

Sub-projects #1–#5 are complete. Browse and search currently order listings by
`createdAt desc` (newest first) — there is no quality or popularity signal in what
guests see. Sub-project #6 was decomposed into five independently-buildable pieces:

| Piece | Delivers |
|---|---|
| **6a (this doc)** | **Configurable engagement ranking on browse + search** |
| 6b | Analytics expansion (search impressions, CTR, funnels, time-series, dashboards) |
| 6c | Personalization (per-user reorder / recommendations) |
| 6d | Sponsored boosts (paid placement, labeling, caps) |
| 6e | Anti-gaming (event de-dupe / bot filtering, rate limiting) |

This spec covers **6a only**. It is the foundation the other four build on.

## 2. Goal

Order the main browse grid and search results by a transparent, admin-tunable
**engagement score** instead of newest-first, reusing the analytics the platform
already records. New listings must still surface (no cold-start burial).

## 3. Scope

### In scope
- Engagement-only score from existing `AnalyticsEvent` counts: **views, WhatsApp
  inquiry clicks, wishlist saves** (all-time totals).
- **Admin-configurable weights** stored in `PlatformSettings`, edited via the
  existing admin Settings form. Defaults: `view = 1`, `save = 3`, `click = 5`.
- Ranking as the **default order** on:
  - the homepage **"Stays you'll love"** grid (`getPublishedListings`), and
  - **search results** (`searchListings`).
- Tie-break (equal scores, including brand-new listings at score 0) by
  **`createdAt desc`** so new listings still appear, just below proven performers.
- Pure, unit-tested scoring core (mirrors `lib/pricing.ts`).

### Explicitly out of scope (later #6 pieces)
- Rating, recency-decay, and featured signals in the score (engagement only).
- The admin-curated **Featured strip** stays curated/newest — ranking does not
  touch it.
- Sponsored boosts (6d), personalization (6c), richer analytics (6b),
  anti-gaming event filtering (6e), and any guest-facing "Sort by" control.

## 4. Data model

Add three integer fields to the singleton `PlatformSettings` model:

```prisma
rankWeightView   Int @default(1)
rankWeightSave   Int @default(3)
rankWeightClick  Int @default(5)
```

Applied with `npm run db:push` (the project uses db push, not migrations).
Defaults are chosen so a WhatsApp inquiry (strong intent) outweighs a save, which
outweighs a passive view.

## 5. Architecture (Approach A — pure core + cached reads)

No new infrastructure, no cron, no precomputed column. The score is computed at
query time inside the **already-cached** public reads, so the aggregation runs at
most once per cache window.

### New: `lib/ranking.ts`
- `RankWeights` — `{ view: number; save: number; click: number }`.
- `computeRankScore(stats, weights): number` — pure. `stats` is the existing
  `ListingStats` shape `{ views, whatsappClicks, saves }`, so:
  `views*weights.view + whatsappClicks*weights.click + saves*weights.save`.
  Unit-tested.
- `rankListings(listings, statsById, weights)` — returns a **sorted copy** of the
  listings (descending score, tie-break `createdAt desc`). Pure; no DB access.
  Generic over `T extends { id: string; createdAt: Date }`.

### Integration (reuses existing helpers)
`getListingStats(ids)` in [lib/analytics.ts](../../../lib/analytics.ts) already
returns per-listing `{ views, whatsappClicks, saves }` via one `groupBy`.

- **`getPublishedListings`** ([lib/data-access.ts](../../../lib/data-access.ts)):
  fetch the **full** published candidate set (not a pre-paged slice), call
  `getListingStats`, read weights from settings, `rankListings`, then apply
  `skip`/`take` to the **ranked** result. Ranking the whole set before paging is
  required for correctness. Runs inside the existing `unstable_cache`
  (`tags: ["listings"]`, 60s revalidate).
- **`searchListings`** ([lib/search.ts](../../../lib/search.ts)): after the filter
  `where`, fetch matches, rank, then slice to the existing cap (60). Adds one
  `groupBy` per search (search is already uncached/dynamic — acceptable).

### Config plumbing
- `lib/settings.ts` already returns the full `PlatformSettings` row, so the new
  weight fields flow through automatically; callers read `settings.rankWeight*`.
- Admin Settings: add the three weights to the Zod schema + PATCH route
  ([app/api/admin/settings/route.ts](../../../app/api/admin/settings/route.ts)),
  the form ([components/admin/settings-form.tsx](../../../components/admin/settings-form.tsx)),
  and the page initial values ([app/admin/settings/page.tsx](../../../app/admin/settings/page.tsx)).
- The settings PATCH route additionally calls `revalidateTag("listings")` so a
  weight change re-ranks browse immediately (it already revalidates `"settings"`).

## 6. Files

**New:** `lib/ranking.ts`, `lib/ranking.test.ts`.
**Edit:** `prisma/schema.prisma`, `lib/data-access.ts`, `lib/search.ts`,
admin settings route + form + page.

## 7. Testing & verification

- **Unit (`lib/ranking.test.ts`):** `computeRankScore` weighting math;
  `rankListings` orders by score descending and tie-breaks by `createdAt desc`;
  zero-engagement listings sort last but are present.
- **Build/typecheck:** `npm run build`.
- **Schema:** `npm run db:push`.
- **Manual:** with seed data, a listing with more WhatsApp clicks ranks above a
  newer one with only views; raise `rankWeightView` in admin Settings → order
  shifts toward high-view listings; confirm a freshly created listing still
  appears (tie-break), not buried.

## 8. Forward compatibility

The pure scoring core and the "fetch → score → sort" seam keep a future move to a
precomputed `rankScore` column + scheduled refresh (for large catalogs, 6e/scale)
a **localized change** — page and component code stay untouched. Adding signals
(rating, recency, sponsored) later means extending `computeRankScore` and its
weights, not re-plumbing the reads.
