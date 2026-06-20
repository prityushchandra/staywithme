# MyBnB — Vacation Rental Marketplace (Sub-project #1: Foundation)

An original, Airbnb-inspired vacation-rental marketplace with a **WhatsApp-first
inquiry model**. Guests browse listings and contact the platform on WhatsApp —
there is no on-platform booking, payment, or host messaging. Built Vercel-native
with Next.js.

> Not affiliated with Airbnb. No Airbnb code, content, images, or assets are used.
> Airbnb is referenced only for UX inspiration.

## What's in this build (Sub-project #1)

The foundation vertical that proves the business model end to end:

- **Auth** — email/password + Google OAuth (NextAuth/Auth.js v5), single-account
  model where any guest can opt into hosting; admin is seeded.
- **Host** — create a listing (details, amenities, cancellation policy, photos,
  base price) with a **live price insight**; listings enter moderation as `PENDING`.
- **Admin** — moderation queue to **approve & publish** or **reject** listings.
- **Public** — home grid + listing detail page, both served **only published**
  listings via an approval-gated data layer.
- **Global WhatsApp contact** — every inquiry routes to the platform number with a
  pre-filled message; hosts can never change or hide it.
- **Platform Fee pricing** — single source of truth (`computePricing`), the label
  is always "Platform Fee", never "Service Fee".

Later sub-projects (search, premium gallery, host/admin dashboards, reviews,
ranking/analytics, SEO/perf hardening) build on this foundation. See
`docs/superpowers/specs/2026-06-17-foundation-core-listing-vertical-design.md`.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind + ShadCN UI · Prisma · Neon Postgres ·
NextAuth v5 · Cloudinary · React Query · Vitest. Deploys to **Vercel**.

## Local development

### 1. Prerequisites
- Node.js 20+ (the repo runs on 18 but Vercel/tooling prefer 20+)
- A Neon Postgres database (free tier) — https://neon.tech
- (Optional) Cloudinary account for image uploads — https://cloudinary.com
- (Optional) Google OAuth credentials

### 2. Install & configure
```bash
npm install
cp .env.example .env        # then fill in values (see below)
```

Generate `AUTH_SECRET`:
```bash
openssl rand -base64 32
```

### 3. Set up the database
Use the **pooled** Neon connection string (host contains `-pooler`) as `DATABASE_URL`.
```bash
npm run db:push     # create tables from the Prisma schema
npm run db:seed     # demo users, amenities, listings, platform settings
```

Seeded accounts (change in production):
| Role  | Email                | Password    |
|-------|----------------------|-------------|
| Admin | `admin@mybnb.local`  | `admin12345`|
| Host  | `host@mybnb.local`   | `host12345` |
| Guest | `guest@mybnb.local`  | `guest12345`|

### 4. Run
```bash
npm run dev          # http://localhost:3000
npm test             # unit tests (pricing, WhatsApp, insights)
npm run build        # production build (what Vercel runs)
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon **pooled** connection string |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` locally; deployed URL on Vercel |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ➖ | Enables Google sign-in; omit to use email/password only |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | ➖ | Enables the Cloudinary upload widget |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | ➖ | Server-side Cloudinary ops |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | ➖ | Unsigned preset name (default `mybnb_listings`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ➖ | Seeded admin account |

Without Cloudinary, the listing form still works — paste image URLs instead of
uploading.

## Deploying to Vercel

1. **Create a Neon database** and copy the **pooled** connection string.
2. **Import the repo** into Vercel (New Project → Import). Framework auto-detects
   as Next.js. No special build settings needed — the build command
   `prisma generate && next build` is in `package.json`.
3. **Add environment variables** in Vercel → Project → Settings → Environment
   Variables (at minimum `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL` set to your
   Vercel URL). Add Google/Cloudinary keys if used.
4. **Deploy.** After the first deploy, run the schema push and seed against the
   production DB from your machine (with the production `DATABASE_URL`):
   ```bash
   DATABASE_URL="<neon-pooled-url>" npm run db:push
   DATABASE_URL="<neon-pooled-url>" npm run db:seed
   ```
5. **Google OAuth redirect** (if used): add
   `https://<your-app>.vercel.app/api/auth/callback/google` to the authorized
   redirect URIs in Google Cloud Console.

### Why this deploys cleanly
- Single Next.js app — no separate backend, Docker, or Nginx to host.
- Prisma uses a **singleton client** + Neon **pooled** connection (serverless-safe).
- Auth is split into an **Edge-safe config** (middleware) and a **Node config**
  (Prisma/bcrypt), so middleware never bundles Prisma.
- DB-backed pages are `force-dynamic`, so the build never connects to a database.

## Project structure

```
app/            App Router pages + route handlers (API)
components/     UI primitives (ShadCN) + platform components
lib/            Rules & data access (pricing, whatsapp, auth, db, settings, validation)
prisma/         schema.prisma + seed.ts
auth.config.ts  Edge-safe auth config (middleware)
middleware.ts   Route protection (/host, /admin)
```

Key principle: platform rules live in `lib/` (pricing, the published-only data
layer, the WhatsApp link builder, the settings reader) so they cannot be bypassed
page-by-page.

## Tests

```bash
npm test
```
Covers the rules that must be exact: `computePricing` (platform fee + rounding),
`getPriceInsight` (under/within/above the suggested range), and the WhatsApp
link/message builder (correct number, encoding, all required fields).
