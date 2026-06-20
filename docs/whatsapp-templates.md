# WhatsApp message templates (Gupshup / Meta)

WhatsApp blocks **business-initiated** freeform messages to anyone without an open
24-hour session. Every message the app sends to a guest or host who hasn't just
messaged our business number therefore needs a **Meta-approved template**:

- **OTP** — every first-time login is to a number that's never messaged us.
- **Booking confirmation** (guest + host) — sent when the admin reserves.
- **3-day reminder** (guest + host).

The bot's *replies to the admin* stay freeform (the admin just messaged the bot,
so the 24h window is open).

## How it works in the code

`sendNotification(to, templateKey, params, fallbackBody)` (lib/wa-send.ts):
- If the template's id env var is set → sends the **approved template** (reaches any number).
- Otherwise → sends `fallbackBody` **freeform** (only reaches the sandbox / opted-in numbers).

So nothing breaks before approval; each message simply upgrades to template delivery
once you create it and set its id.

## Create these templates in Gupshup → set the ids

Create each in the Gupshup console (Templates → Create), category **Utility**
(except OTP = **Authentication**). Submit with example values. Use the placeholders
**in the exact order below** — the code fills them in that order. Keep the text plain
(no `*bold*`; Meta is stricter on templates). After approval, copy each template's
**id** and set the matching env var (Vercel + local `.env`).

> Note: WhatsApp templates can't send an empty placeholder. The app always fills
> every param (a "due" of `₹0` when nothing is owed), so this is handled.

### 1. OTP — `GUPSHUP_TPL_OTP`  (category: Authentication)
Create an **Authentication** template with a **Copy code** button. Meta supplies the
fixed wording; the one parameter is the code.
- `{{1}}` = the 6-digit code

### 2. Booking confirmed — guest — `GUPSHUP_TPL_BOOKING_GUEST`  (Utility)
```
Booking confirmed

{{1}}
Location: {{2}}

Check-in: {{3}}
Check-out: {{4}}

Total: {{5}}
Paid: {{6}}
Balance due (pay to your host at check-in): {{7}}

For check-in queries, contact your host: {{8}}
```
Params: 1 title · 2 location (e.g. L1339, Paradise) · 3 check-in · 4 check-out ·
5 total · 6 paid · 7 balance due · 8 host name + number

### 3. New booking — host — `GUPSHUP_TPL_BOOKING_HOST`  (Utility)
```
New booking confirmed

{{1}}
Guest: {{2}}

Check-in: {{3}}
Check-out: {{4}}

Collect from guest at check-in: {{5}}
Your payout on check-in: {{6}}
```
Params: 1 location · 2 guest name + number · 3 check-in · 4 check-out ·
5 amount to collect · 6 host payout

### 4. Reminder — guest — `GUPSHUP_TPL_REMINDER_GUEST`  (Utility)
```
Reminder - your stay is in 3 days

{{1}}

Check-in: {{2}}
Check-out: {{3}}

Address: {{4}}
Host: {{5}}

Balance due (pay to host at check-in): {{6}}

For any queries about the flat, please contact your host.
```
Params: 1 title · 2 check-in · 3 check-out · 4 address (L1339, Paradise) ·
5 host name + number · 6 balance due

### 5. Reminder — host — `GUPSHUP_TPL_REMINDER_HOST`  (Utility)
```
Reminder - guest arriving in 3 days

{{1}}
{{2}}

Guest: {{3}}
Collect at check-in: {{4}}

Please get the flat ready.
```
Params: 1 location · 2 dates · 3 guest name + number · 4 amount to collect

## Status — submitted to Meta via API (2026-06-20)

All six transactional templates were created programmatically through the Gupshup
template API and are **PENDING** Meta review. Their ids are below (also in `.env`,
commented). **Uncomment each env var only once its status is APPROVED** — sending
via a PENDING template fails; until then the app falls back to freeform.

| Env var | Template id | Status |
|---|---|---|
| `GUPSHUP_TPL_BOOKING_GUEST` | `afcecf6b-6e45-4b78-a9a8-7bcad90c5f35` | PENDING |
| `GUPSHUP_TPL_BOOKING_HOST` | `31b7aa56-b4e3-4ff7-9d45-ff9df7369d58` | PENDING |
| `GUPSHUP_TPL_REMINDER_GUEST` | `298754a5-5870-4507-87a0-93bcad70b4fc` | PENDING |
| `GUPSHUP_TPL_REMINDER_HOST` | `c0996cbb-d565-43a9-a4ad-946d1584a0ad` | PENDING |
| `GUPSHUP_TPL_CANCEL_GUEST` | `cc6f693a-d70c-4ee5-8d1a-bdf9c8618ff2` | PENDING |
| `GUPSHUP_TPL_CANCEL_HOST` | `1edcfe11-8fe6-41fb-9f2d-a36ee797de79` | PENDING |
| `GUPSHUP_TPL_OTP` | — | BLOCKED — needs an Authentication template (Meta business verification) |

Check status anytime: `node scripts/template-status.mjs`

### OTP is the exception
OTP content must be an **Authentication**-category template, and Meta blocks those
("account does not have permission to create message template") until **business
verification** is complete. A Utility "verification code" template was rejected.
So OTP-to-new-numbers stays on freeform (sandbox / opted-in only) until you finish
Meta business verification, then create the Authentication OTP template.

## Not yet templated
Cancellation messages (guest + host) are still freeform — fine while testing, but
add `Utility` templates for them later the same way if you want them to deliver
reliably outside the 24h window.
