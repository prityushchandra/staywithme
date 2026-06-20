# MyBnB — Sub-project #1: Foundation & Core Listing Vertical

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation planning

---

## 0. Context & Legal Constraint

MyBnB is a vacation-rental marketplace that **feels like Airbnb** in UX but is built
entirely from original code and assets. Airbnb is used only as a UX/interaction
reference. No Airbnb code, content, images, listings, trademarks, or assets are
copied or scraped.

**The defining business-model twist:** this is *not* a direct-booking platform.
Guests never book, pay, or message hosts on-platform. Every "Reserve / Book /
Contact Host" action is replaced by a single **Contact on WhatsApp** action that
routes every inquiry to the platform number **+91 8789194107**.

This document specifies **Sub-project #1 only** — the foundation vertical that
proves the business model end to end. The full platform is decomposed into 7
sub-projects (see §1); #2–#7 each get their own spec → plan → build cycle.

---

## 1. Platform Decomposition (for orientation)

| # | Sub-project | Delivers |
|---|---|---|
| **1 (this doc)** | **Foundation & Core Listing Vertical** | Scaffold, full schema, auth + roles, host listing creation, image upload, admin approval, global WhatsApp inquiry component, platform-fee pricing, host price insight, minimal public listing page |
| 2 | Public Browse, Search & Detail | Airbnb-style homepage, search + filters, listing cards, premium gallery/detail page, wishlists |
| 3 | Host Dashboard | Listing management, availability, per-listing analytics & insights |
| 4 | Admin Dashboard | Full moderation, platform settings, sponsored boosts, platform analytics |
| 5 | Reviews System | Reviews, images, ratings, distribution |
| 6 | Ranking, Analytics, Personalization & Anti-Gaming | Configurable ranking engine, tracking, personalization, sponsored, fraud protection |
| 7 | SEO, Performance & Security Hardening | Metadata, sitemap, schema, Lighthouse 90+, rate limiting, CSRF, validation |

---

## 2. Technology Stack (Vercel-native)

The original brief specified NestJS + Docker + Nginx, which **cannot run on Vercel**
(serverless). To meet the "deploy on Vercel with no deployment errors" requirement,
the architecture is a single Vercel-native Next.js full-stack app:

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + React + TypeScript |
| Styling/UI | Tailwind CSS + ShadCN UI + Framer Motion |
| Data fetching | React Query (client), Server Components / Route Handlers / Server Actions |
| ORM | Prisma |
| Database | **Neon** serverless Postgres (built-in pooling, Vercel-friendly) |
| Auth | NextAuth (Auth.js) — credentials (email/password) + Google OAuth, JWT sessions |
| Image storage | **Cloudinary** (upload + transformations + responsive cropping) |
| Currency | **INR (₹)** only; price stored as integer minor units; multi-currency deferred |
| Deploy target | **Vercel** |

NestJS / Docker / Nginx are intentionally dropped. The future-scalability goals
(payments, direct booking, ML ranking, multi-currency/language) are preserved by
schema and module boundaries, not by the server framework.

---

## 3. Scope of Sub-project #1

### In scope
- Project scaffold, deployable to Vercel from day one.
- **Full platform data model** (designed once, correctly; later sub-projects add
  features, not schema-rewrites).
- Auth: email/password + Google, single-account model, opt-in hosting, seeded admin.
- Host: create/edit a listing (core fields + amenities + cancellation policy + photo
  upload to Cloudinary) → saved as **Draft**, submitted for approval.
- Admin: pending-listings queue, **Approve / Reject** transitions.
- Public: a **minimal** listing page rendering an approved listing with the
  **WhatsApp Contact button** and **platform-fee pricing breakdown**.
- Host **price insight** panel (static recommended range now, data-driven later).
- Seed data: demo users, listings, amenities, cancellation text, platform settings.
- Unit tests for the rules that must be exact (pricing, WhatsApp link/message,
  published-only filter).
- README with env vars + Vercel deploy steps.

### Explicitly deferred (later sub-projects)
Airbnb-style homepage, search/filters, premium gallery/detail polish (#2); host
analytics dashboard (#3); full admin dashboard (#4); reviews (#5);
ranking/analytics/personalization/anti-gaming (#6); SEO/perf/security hardening (#7).

The public page in #1 is intentionally plain — just enough to demonstrate the
inquiry + approval + pricing rules working. Polish arrives in #2.

---

## 4. Data Model

Prices stored as **integers in minor units (paise)**, displayed as ₹.
Listings carry **no contact/phone fields, ever** — contact routing is global only.

### Core models (built and used in #1)

- **User** — `id`, `name`, `email` (unique), `passwordHash` (nullable for OAuth),
  `image`, `roles` (string[]/flags; `GUEST` always present, `HOST` added on opt-in),
  `isAdmin` (bool, seeded only), timestamps.
- **Account / Session / VerificationToken** — NextAuth standard tables.
- **Listing** — `id`, `hostId`→User, `title`, `description`, `propertyType` (enum),
  `roomType` (ENTIRE / PRIVATE / SHARED), `addressLine`, `city`, `country`, `lat`,
  `lng`, `bedrooms`, `bathrooms`, `beds`, `maxGuests`, `basePrice` (int minor units),
  `cancellationPolicy` (enum FLEXIBLE / MODERATE / STRICT, **required**),
  `status` (DRAFT / PENDING / APPROVED / REJECTED / PUBLISHED), `rejectionReason`
  (nullable), timestamps. **No phone/contact columns.**
- **ListingImage** — `id`, `listingId`, `cloudinaryPublicId`, `url`, `width`,
  `height`, `order`, `isCover`.
- **Amenity** — seeded catalog: `id`, `key`, `label`, `icon`.
- **ListingAmenity** — join (`listingId`, `amenityId`).
- **PlatformSettings** — single-row config (enforced one row). Fields:
  `whatsappNumber` (default `+918789194107`), `platformFeePercent` (default 10),
  `suggestedPriceMin` (default 2200_00), `suggestedPriceMax` (default 2500_00).
  **Admin-only**; hosts have no access.
- **CancellationPolicyText** — seeded reference rows mapping each policy enum value
  to admin-editable human-readable description text (so wording changes need no code).

### Stub models (created now, populated by later sub-projects)
Empty/minimal models so later relations exist without migrations:
- **Wishlist** / **WishlistItem** (→ #2)
- **Review** (→ #5)
- **AnalyticsEvent** (→ #6)

---

## 5. The Two Platform Rules + Pricing (heart of #1)

### 5.1 WhatsApp inquiry — global, locked component
- A single `<WhatsAppContactButton>` component reads the number from
  `PlatformSettings` **server-side**.
- It builds `https://wa.me/918789194107?text=<encoded message>` where the message is
  pre-populated with: Property name, Property ID, Check-in, Check-out, Guests,
  Displayed Total Price. Message template:

  ```
  Hello,
  I am interested in the following property:
  Property: <title>
  Property ID: <id>
  Check-in: <date>
  Check-out: <date>
  Guests: <n>
  Displayed Price: ₹<total>
  Please share more details.
  ```
- **Hosts can never** edit/replace/hide/disable the number or button, add their own
  phone, or change routing. This is structural: no host-editable field touches
  contact info, and the number lives only in `PlatformSettings` (admin-only).
- Every "Reserve / Book / Contact Host / Message Host" CTA renders this one component.

### 5.2 Approval gate
- A shared data-access layer (`/lib/data-access`) is the **only** path public pages
  use to read listings, and it **always** filters `status = PUBLISHED`. The filter is
  not repeated per page, so it cannot be forgotten.
- Draft / Pending / Rejected listings are invisible publicly.
- Only an admin-guarded action can transition `PENDING → APPROVED → PUBLISHED` (or
  `→ REJECTED` with a `rejectionReason`).
- Status flow: **Draft → Pending Approval → Approved → Published.**

### 5.3 Pricing — "Platform Fee", never "Service Fee"
- Single pure function `computePricing(basePrice, settings)` →
  `{ base, platformFee = round(base × platformFeePercent / 100), total = base + platformFee }`.
- Used identically on listing card, property page, inquiry summary, and the WhatsApp
  message — **one source of truth**. Changing the admin fee % updates everywhere.
- The only label used is **"Platform Fee"**. The string "Service Fee" never appears.
- Example: base ₹1000, fee 10% → Platform Fee ₹100 → Total ₹1100.

### 5.4 Host price insight
- A live panel beside the base-price field in the host form.
- Function `getPriceInsight(price, settings)` compares the host's price to
  `suggestedPriceMin`/`suggestedPriceMax` (default ₹2,200–₹2,500, admin-configurable):
  - within range → "✓ Your price is competitive for similar stays."
  - below min → "Similar listings go for ₹2,200–₹2,500 — you may be underpricing."
  - above max → "Most similar stays are ₹2,200–₹2,500 — a lower price may get more inquiries."
- The range is a **static configured value now** (no market data exists until #6).
  The UI and `getPriceInsight` are designed so #6 swaps the static range for a real
  "comparable listings in this area" computation with **no UI changes**.

### 5.5 Cancellation policy
- Host selects exactly one of **Flexible / Moderate / Strict** (required radio;
  no free text — hosts cannot invent their own terms).
- **Display-only metadata.** This platform has no on-platform booking/payment, so
  there is no refund/enforcement engine; actual cancellation is handled over
  WhatsApp. The policy is shown on the listing (minimal in #1, polished in #2).
- Descriptions come from the seeded `CancellationPolicyText` (admin-editable wording).

---

## 6. Auth Flow & Roles

- **NextAuth (Auth.js)**: credentials provider (bcrypt-hashed password) + Google
  OAuth, both issuing JWT sessions.
- New signups get `roles: [GUEST]`. A "Become a host" action adds `HOST` (same
  account browses and lists). Admin is **seeded** via an env-configured email and is
  never self-assignable.
- Route protection via middleware: `/host/*` requires `HOST`, `/admin/*` requires
  `isAdmin`, public routes open.

---

## 7. Folder Structure

```
/app
  /(public)        → minimal public listing page, home placeholder
  /(auth)          → sign-in / sign-up
  /host            → become-host, create/edit listing
  /admin           → pending-listings approval queue
  /api             → route handlers (listings, image upload, admin actions, auth)
/components
  /ui              → ShadCN primitives
  WhatsAppContactButton.tsx
  PricingBreakdown.tsx
  PriceInsight.tsx
  listing-form/*
/lib
  db.ts            → Prisma client (singleton)
  auth.ts          → NextAuth config
  pricing.ts       → computePricing, getPriceInsight
  whatsapp.ts      → buildWhatsAppLink / buildInquiryMessage
  data-access.ts   → published-only listing reads, settings reader
  cloudinary.ts
/prisma
  schema.prisma
  seed.ts
/types
```

**Principle:** shared logic lives in `/lib` (`pricing.ts`, `whatsapp.ts`,
published-only `data-access.ts`, settings reader) so the platform rules cannot be
bypassed page-by-page.

---

## 8. Seed Data & Demo Images (IP-safe)

- Seed: 1 admin user, 1 demo host, a few guest users; 3–5 demo listings across
  property/room types and cancellation policies; the amenity catalog; cancellation
  policy text; and the single `PlatformSettings` row (WhatsApp +918789194107, fee 10%,
  suggested range 2200–2500).
- Demo photos sourced from **Unsplash** (permissive license, original photographers —
  **not** Airbnb assets), stored via Cloudinary. Keeps the build clear of the
  Airbnb-content restriction.

---

## 9. Testing & Documentation

- **Vitest** unit tests for the rules that must be exact:
  - `computePricing` (rounding, fee %, total).
  - `getPriceInsight` (below / within / above thresholds).
  - `buildWhatsAppLink` / `buildInquiryMessage` (correct number, encoding, all fields).
  - published-only data-access filter (never returns non-PUBLISHED).
- **README** documents env vars (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
  `GOOGLE_CLIENT_ID`/`SECRET`, `CLOUDINARY_*`, `ADMIN_EMAIL`) and the Vercel deploy
  steps (Neon connection string with pooling, env config, build).

---

## 10. Future Scalability (preserved, not built)

Schema and module boundaries keep these add-able without major refactor:
payments & direct booking (price + policy already per-listing), dynamic/data-driven
pricing (insight function is swappable), ML ranking (stub `AnalyticsEvent`),
reviews (stub `Review`), wishlists (stub `Wishlist`), multi-currency (minor-unit
integer prices), multi-language.

---

## 11. Open Items / Non-Goals for #1

- No search, no homepage polish, no premium gallery (→ #2).
- No reviews, wishlists UI, analytics dashboards, ranking engine (→ #3–#6).
- No payment gateway, no on-platform booking, no refund engine (by design).
- No host-editable contact info of any kind (by design, permanently).
