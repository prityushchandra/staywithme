# MyBnB — Sub-project #3: Host Dashboard

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation
**Builds on:** #1 (Foundation) and #2 (Browse/Search/Detail)

---

## 1. Goal

Give hosts a real control center: an overview dashboard with live per-listing
numbers, the ability to **edit/delete** listings (a gap from #1), and an
**availability system** so confirmed WhatsApp bookings can block dates across the
whole portal.

## 2. Scope

### In scope
- **Dashboard home** (`/host`) — KPI overview (listings by status; total views,
  wishlist saves, WhatsApp clicks across the host's listings) and a management
  table with per-listing stats + actions.
- **Edit & delete listings** — full edit (reuses the listing form). Editing an
  already-PUBLISHED/APPROVED listing returns it to **PENDING** (content changed →
  re-moderation). Drafts/rejected stay in host control; rejected can be fixed and
  resubmitted. Delete with confirmation.
- **Lightweight analytics tracking** — record three events and surface them:
  - `VIEW` — listing detail page viewed (client-fired once per mount).
  - `WHATSAPP_CLICK` — the Contact-on-WhatsApp button clicked.
  - `WISHLIST_ADD` — a listing saved to a wishlist.
  Aggregates shown on the dashboard. (Full funnels/CTR/anti-gaming/time-series →
  #6; this just starts collecting + shows counts.)
- **Availability** — manual entry, automated propagation:
  - Host/admin can **block date ranges** or **record a confirmed booking** for a
    listing (the WhatsApp-booking workflow: confirm in chat → enter once here).
  - Blocked ranges auto-propagate: the listing's availability calendar shows them,
    and the guest inquiry date-picker rejects overlapping ranges (disables the
    WhatsApp CTA with "Not available for these dates").

### Deferred (with reasons)
- **Fully-automated WhatsApp Business API** (bot reads chat → blocks dates) —
  requires Meta business verification, Cloud API, webhooks, templates. Its own
  future sub-project. We do manual-entry + auto-propagation now.
- **Analytics charts, CTR, conversion funnels, anti-gaming** — Sub-project #6.
- **Platform-wide admin analytics** — Sub-project #4.

## 3. Data model changes

Add one model; no breaking changes.

```
model AvailabilityBlock {
  id          String   @id @default(cuid())
  listingId   String
  listing     Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  startDate   DateTime // check-in, inclusive (date at UTC midnight)
  endDate     DateTime // check-out, exclusive
  kind        String   // "BOOKING" | "MANUAL"
  guestName   String?
  guests      Int?
  note        String?
  createdById String?  // user who recorded it (host or admin)
  createdAt   DateTime @default(now())
  @@index([listingId])
}
```
`AnalyticsEvent` (already exists from #1) is now written to.

## 4. Key logic

- **Overlap rule** (pure, tested): ranges `[aStart,aEnd)` and `[bStart,bEnd)`
  overlap iff `aStart < bEnd && bStart < aEnd`. A requested stay is available iff
  it overlaps no block.
- **Edit → re-moderation**: `PATCH /api/listings/[id]` by the owner/admin. If the
  listing was PUBLISHED/APPROVED, status resets to PENDING.
- **Auth**: only the listing's host (owner) or an admin may edit/delete/manage
  availability. Enforced in each route handler.

## 5. New/changed files

- `prisma/schema.prisma` — add `AvailabilityBlock`, relation on `Listing`.
- `lib/availability.ts` — overlap helpers + DB read/write.
- `lib/analytics.ts` — `recordEvent` + per-host aggregates.
- `app/api/track/route.ts` — client event sink (VIEW, WHATSAPP_CLICK).
- `app/api/wishlist/toggle/route.ts` — record `WISHLIST_ADD` on save.
- `app/api/listings/[id]/route.ts` — `PATCH` (edit) + `DELETE`.
- `app/api/listings/[id]/availability/route.ts` — `POST` block, `DELETE` block.
- `components/listing-form.tsx` — support edit mode (initial values + PATCH).
- `components/track-view.tsx` — client view-beacon.
- `components/availability-calendar.tsx` — month calendar (read-only + host mode).
- `components/availability-manager.tsx` — host block/booking form + list.
- `components/host-stats.tsx`, `components/delete-listing-button.tsx`.
- `app/host/page.tsx` — dashboard home.
- `app/host/listings/[id]/edit/page.tsx`, `.../availability/page.tsx`.
- `app/listings/[id]/page.tsx` — view tracking + availability calendar + inquiry
  date validation.
- `components/inquiry-panel.tsx` + `whatsapp-contact-button.tsx` — block
  unavailable ranges, fire WHATSAPP_CLICK.
- `components/navbar.tsx` — "Hosting" → `/host`.

## 6. Testing

- Unit: `rangesOverlap` / `isRangeAvailable` (touching, nested, adjacent,
  disjoint). Existing pricing/whatsapp/search tests stay green.
- Manual: edit a published listing → back to PENDING; block dates → guest picker
  rejects them; view a listing → dashboard view count increments; click WhatsApp →
  click count increments; save → saves count increments; delete a listing.

## 7. Non-goals for #3
No WhatsApp Business API, no charts/anti-gaming, no admin-wide analytics, no
payment/real booking records beyond the availability block.
