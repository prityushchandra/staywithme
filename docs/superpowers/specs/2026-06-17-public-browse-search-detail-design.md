# MyBnB — Sub-project #2: Public Browse, Search & Detail

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation
**Builds on:** Sub-project #1 (Foundation & Core Listing Vertical)

---

## 1. Goal

Make the public-facing experience feel like Airbnb: a real homepage with search,
a filterable search-results page, polished listing cards with image carousels, a
premium fullscreen gallery on the detail page, and wishlists. All reads continue
to go through the approval-gated data layer (published listings only).

## 2. Scope

### In scope
- **Homepage** — sticky header with an expandable search bar (destination ·
  check-in · check-out · guests), category chips (by property type), and listing
  sections (Featured = newest, Recently added, browse-all grid).
- **Search results page** (`/search`) — URL-param-driven filters: destination
  (city), price range, room type, property type, bedrooms, bathrooms, amenities,
  guests. Results grid; mobile filter sheet; empty/zero-result state.
- **Listing card** — multi-image carousel (swipe + arrow buttons, dot indicators)
  and a wishlist heart.
- **Premium gallery** — detail-page photo grid that opens a fullscreen lightbox
  with swipe gestures, keyboard navigation (←/→/Esc), and mobile optimization.
- **Wishlists** — single default wishlist per user; heart toggles save/unsave; a
  `/wishlists` page lists saved stays.

### Deferred (with reasons)
- **"Instant Booking" filter** — dropped permanently; the platform is WhatsApp-only
  with no on-platform booking, so the concept doesn't apply.
- **Ratings filter/sort, Superhost badge** — require Reviews (#5) and quality
  signals (#6). Cards display "New" until reviews exist.
- **Trending / personalized / sponsored sections** — require analytics + ranking (#6).
- **Interactive map** — requires a Google Maps API key (parked). Location shown as
  text (city, country, address) for now; map added in a later pass.

## 3. Architecture & key decisions

- **Single Next.js app, Vercel-native** (unchanged). New public pages are
  `force-dynamic` and read through `lib/data-access.ts`.
- **Search** is implemented with **Prisma filters** over Postgres, driven by URL
  search params (shareable/bookmarkable). A single `searchListings(params)`
  function in `lib/search.ts` builds the `where` clause; the architecture stays
  ready for a later Postgres full-text / Elasticsearch swap.
- **Wishlist**: a default `Wishlist` row is created lazily per user on first save.
  `WishlistItem` is unique per (wishlist, listing). API:
  - `POST /api/wishlist/toggle` `{ listingId }` → saves/removes, returns `{ saved }`.
  - `GET /api/wishlist` → the user's saved listing ids (for hydrating hearts).
  - `/wishlists` page renders saved listings via the data layer.
- **Carousel & gallery**: client components using Framer Motion; no new deps. The
  gallery lightbox handles swipe (pointer drag), keyboard, and focus trapping.
- **Images**: continue using `SmartImage` so both remote (Unsplash/Cloudinary) and
  locally-uploaded (data URL) photos render.

## 4. Data model

No schema changes required — `Wishlist` and `WishlistItem` already exist (created
as stubs in #1). This sub-project activates them.

## 5. New/changed files (plan)

- `lib/search.ts` — `searchListings(params)` + param parsing/typing.
- `lib/wishlist.ts` — server helpers (get-or-create default wishlist, saved ids).
- `app/api/wishlist/route.ts`, `app/api/wishlist/toggle/route.ts`.
- `components/search-bar.tsx` — expandable header search (destination/dates/guests).
- `components/search-filters.tsx` — filter controls (sidebar + mobile sheet).
- `components/category-chips.tsx` — property-type quick filters.
- `components/listing-card.tsx` — upgrade to carousel + wishlist heart.
- `components/image-carousel.tsx` — reusable card carousel.
- `components/wishlist-button.tsx` — heart toggle (client, session-aware).
- `components/gallery.tsx` — detail-page fullscreen lightbox.
- `components/ui/sheet.tsx`, `components/ui/slider.tsx` — ShadCN primitives.
- `app/page.tsx` — homepage redesign (hero search, chips, sections).
- `app/search/page.tsx` — results page.
- `app/wishlists/page.tsx` — saved stays.
- `app/listings/[id]/page.tsx` — swap gallery in.

## 6. Testing

- Unit-test `searchListings` `where`-clause builder (price range, room/property
  type, bedrooms/bathrooms, amenities AND-match, guests, city contains).
- Manual: search by city + filters, carousel swipe, gallery keyboard/swipe,
  wishlist save/unsave persists across reload, signed-out heart prompts sign-in.

## 7. Non-goals for #2
No reviews, ranking, analytics, personalization, sponsored placement, maps, or
booking. Those are later sub-projects.
