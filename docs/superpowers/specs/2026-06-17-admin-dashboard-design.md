# MyBnB — Sub-project #4: Admin Dashboard

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation
**Builds on:** #1–#3

## 1. Goal
A real admin control center: platform-wide analytics, full listing moderation,
user management, and editable platform settings — plus a lightweight featured-
listings control for homepage curation.

## 2. Scope

### In scope
- **Dashboard home** (`/admin`) — KPIs (users, hosts, listings by status, total
  views / WhatsApp clicks / saves), a pending-approvals highlight, and **top
  listings** + **top hosts** by engagement.
- **Listings moderation** (`/admin/listings`) — all listings with a status filter;
  approve, reject (with reason), unpublish, and **feature/unfeature**.
- **User management** (`/admin/users`) — list users; **promote to admin**, grant
  host, **suspend** (blocks login), and delete. Self-protection: an admin cannot
  suspend/demote/delete their own account.
- **Platform settings** (`/admin/settings`) — edit WhatsApp number, Platform Fee %,
  and suggested price range. Auto-propagates (all reads go through
  `getPlatformSettings`).
- **Featured listings** — `Listing.featured` boolean; homepage shows a "Featured
  stays" section first.
- **Admin layout** — shared nav (Dashboard / Listings / Users / Settings).

### Deferred (with reasons)
- **Sponsored boosts & ranking weights** — meaningless until the ranking engine
  exists; live in Sub-project #6.
- **Review moderation** — needs Reviews (Sub-project #5).

## 3. Data model changes
- `Listing.featured Boolean @default(false)` + `@@index`.
- `User.suspended Boolean @default(false)`.

## 4. Key logic
- **Suspension**: a suspended user fails credentials `authorize` (cannot log in).
  Existing listings remain visible (per decision).
- **Settings**: a single admin `PATCH /api/admin/settings` updates the singleton
  row; WhatsApp number normalised, fee/price validated as non-negative ints.
- **Self-protection**: user-management routes reject actions targeting the acting
  admin's own id for suspend/demote/delete.
- **Auth**: every `/admin/*` route + API re-checks `isAdmin` (middleware already
  gates the path; APIs re-verify server-side).

## 5. New/changed files
- `prisma/schema.prisma` — add `featured`, `suspended`.
- `lib/auth.ts` — block suspended users in `authorize`.
- `lib/admin-analytics.ts` — platform aggregates, top listings/hosts.
- `app/admin/layout.tsx` — admin nav shell.
- `app/admin/page.tsx` — dashboard home (replaces the bare pending queue).
- `app/admin/listings/page.tsx` — full moderation table + filter.
- `app/admin/users/page.tsx` — user management.
- `app/admin/settings/page.tsx` — settings form.
- `app/api/admin/listings/[id]/route.ts` — extend actions: approve/reject/unpublish/
  feature/unfeature.
- `app/api/admin/settings/route.ts` — PATCH settings.
- `app/api/admin/users/[id]/route.ts` — PATCH (suspend/promote/grant-host) + DELETE.
- `components/admin/*` — action components (listing actions, user actions, settings
  form, status filter).
- `app/page.tsx` — featured-first ordering.
- `app/host/listings/new` + listing data — `featured` defaults false; only admin sets it.

## 6. Testing
- Unit: settings validation/normalisation; top-N aggregation shaping (pure parts).
- Manual: edit fee → totals change site-wide; feature a listing → appears in
  Featured; suspend a user → they can't log in; promote a user → they see Admin;
  self-protection blocks acting on own account.

## 7. Non-goals
No sponsored/ranking, no review moderation, no email notifications.
