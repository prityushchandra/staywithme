# Production Deployment — StayWithMe

Two independent tracks. **Track A** (deploy the app to Vercel) you can finish today.
**Track B** (real WhatsApp number) is gated by Meta approval — start it now, it runs in
parallel and takes the longest.

---

## Track A — Deploy the app to Vercel

The codebase is now serverless-correct: conversation state lives in the DB
(`BotConversation`), notifications use `after()`, and reminders run via Vercel Cron
(`vercel.json` → `/api/cron/reminders`). Nothing else needs code changes to deploy.

### 1. Put the code on GitHub

It isn't a git repo yet. `.env` is already gitignored, so secrets won't be pushed —
**verify that** before pushing.

```bash
cd c:/Users/prchandra/workspace_personal/mybnb
git init
git add -A
git status            # confirm .env is NOT listed
git commit -m "StayWithMe — production-ready (Vercel serverless)"
gh repo create staywithme --private --source=. --push     # or create on github.com and: git remote add origin <url> && git push -u origin main
```

### 2. Import into Vercel

1. vercel.com → **Add New → Project** → import the `staywithme` repo.
2. Framework preset: **Next.js** (auto-detected). Build command stays `npm run build`
   (it runs `prisma generate && next build`). No changes needed.
3. **Before** the first deploy, add the environment variables (next step).

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Set every one of these for the **Production** environment (copy values from your local
`.env`, except the ones marked NEW / CHANGE):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Your Neon **pooled** URL (the `...-pooler...` one — you already use it). If you hit "prepared statement" errors, append `?pgbouncer=true`. |
| `AUTH_SECRET` | Same as local. |
| `NEXTAUTH_URL` | **CHANGE** → `https://<your-app>.vercel.app` (or your custom domain). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PHONE` | Same as local. `ADMIN_PHONE` = the WhatsApp number that drives the bot. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Same as local. **Also** add `https://<your-app>.vercel.app/api/auth/callback/google` to Authorized redirect URIs in Google Cloud Console. |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Same as local. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Same as local (until you finish Track B). |
| `TWILIO_WHATSAPP_FROM` | Sandbox `whatsapp:+14155238886` for now; swap to your production sender after Track B. |
| `TWILIO_WEBHOOK_URL` | **NEW** → `https://<your-app>.vercel.app/api/whatsapp/webhook`. Setting this turns ON Twilio signature verification in prod (the webhook rejects forged requests). |
| `CRON_SECRET` | **NEW** → a long random string. Vercel sends it to the cron automatically; it blocks anyone else from triggering reminders. Generate: `openssl rand -hex 32`. |

> If a Google sign-in redirect ever fails on Vercel, also add `AUTH_TRUST_HOST=true`.

### 4. Deploy & point Twilio at production

1. Click **Deploy**. When it's live, note the URL (`https://<your-app>.vercel.app`).
2. Twilio Console → your WhatsApp Sandbox (or, after Track B, your sender) → **"When a
   message comes in"** → set to `https://<your-app>.vercel.app/api/whatsapp/webhook`,
   method **POST**. (The old cloudflared tunnel is no longer needed — delete it from
   your mind; it was only for local testing.)
3. The reminders cron (`vercel.json`) runs daily at **09:00 UTC** (≈2:30 PM IST).
   On the Vercel **Hobby** plan, cron is limited to once/day — which is exactly right
   here (each booking enters the 3-day window for one day and is reminded once). On Pro
   you can make it more frequent by editing the `schedule` in `vercel.json`.

### 5. Smoke test

- Open the Vercel URL → site loads, you can sign in.
- From your admin WhatsApp, send `help` to the bot → you get the command list.
- Run a `reserve` flow end-to-end → you get the `Reserved` summary.
  (Outbound messages to host/guest still need Track B + leaving the Twilio trial — see below.)

---

## Track B — Real WhatsApp number (Meta + Twilio)

This replaces the sandbox `+14155238886`. It's a process, not code. Order matters; the
Meta steps are the slow part — **start today**.

### Prerequisites you control
- A **phone number** you can dedicate to the bot that is **not currently registered on
  WhatsApp** (or you're willing to delete its WhatsApp account first). A landline or a
  fresh SIM both work.
- Ability to receive an SMS/voice OTP on that number during registration.

### Steps
1. **Leave the Twilio trial.** Twilio Console → Billing → add a payment method / balance.
   This also lifts error **63038** (the daily message cap you hit during testing).
2. **Create a Meta Business Manager.** business.facebook.com → create a Business. Add
   your business details. Start **business verification** (can take hours–days; begin now).
3. **Register a WhatsApp Sender in Twilio.** Twilio Console → Messaging → **Senders →
   WhatsApp senders → Create**. Connect your Meta Business, choose the phone number,
   set the **display name** (e.g. "StayWithMe"). Twilio walks you through Meta approval.
4. **Get message templates approved.** WhatsApp only allows *freeform* replies within 24h
   of the user messaging you. The bot's replies to **you (admin)** are freeform and fine.
   But **business-initiated** messages need pre-approved templates — for StayWithMe that's:
   - Booking confirmed → guest
   - New booking → host
   - 3-days-before reminder → guest, and → host
   - Booking cancelled → guest, and → host

   Submit these as templates in Twilio (Content Template Builder) / Meta. Approval is
   usually minutes–hours.
5. **Switch the app over.** In Vercel, change `TWILIO_WHATSAPP_FROM` to
   `whatsapp:<your-approved-number>` and redeploy. Update the Twilio Sender's inbound
   webhook to the same `/api/whatsapp/webhook` URL.

### Code note (template support) — TODO when templates are approved
Right now `lib/twilio.ts > sendWhatsApp()` sends **freeform** body text. That works for
admin replies and (within the 24h window) anything else, but business-initiated messages
outside the window will be rejected by WhatsApp until they're sent as templates. When your
templates are approved, we'll add a `sendTemplate(to, contentSid, variables)` path and
route the host/guest/reminder notifications through it. Flag me then — it's a small change.

---

## Track B (alternative) — Gupshup instead of Twilio

The app now supports **Gupshup** as a drop-in WhatsApp provider, selected by
`WHATSAPP_PROVIDER`. Twilio stays the default, so you can keep testing on the Twilio
sandbox while Gupshup gets approved, then flip one env var.

### Console setup (gupshup.io)
1. **Create a Gupshup account** at gupshup.io and open the **WhatsApp** product.
2. **Onboard your number** via Gupshup's embedded signup. Same Meta gate as everyone:
   it connects/creates your **Meta Business + WhatsApp Business Account**, registers the
   **phone number** (must not already be on WhatsApp), and submits the **display name**
   (e.g. `StayWithMe`). Full business verification can come later — an unverified WABA can
   still message a limited number of recipients for testing.
3. **Create an App** in Gupshup for this number. Note its **App name**.
4. **Get your API key** (Gupshup dashboard → top-right account menu → **API key**).
5. **Set the callback (inbound) URL** for the app to:
   `https://<your-app>.vercel.app/api/whatsapp/webhook?token=<GUPSHUP_WEBHOOK_TOKEN>`
   (Gupshup app settings → Callback URL). The `?token=` must match the env var below.
6. **Create message templates** for the business-initiated notifications (booking
   confirmed/cancelled to guest+host, the two 3-day reminders) — same Meta requirement as
   Twilio. (Template SENDING still needs the small `sendTemplate()` follow-up in code.)

### Environment variables (set in Vercel + local `.env`)
| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `gupshup` (omit or `twilio` to stay on Twilio) |
| `GUPSHUP_API_KEY` | from the Gupshup dashboard |
| `GUPSHUP_APP_NAME` | your Gupshup App name (sent as `src.name`) |
| `GUPSHUP_SOURCE` | the registered WhatsApp number, digits only (e.g. `919812345678`) |
| `GUPSHUP_WEBHOOK_TOKEN` | a random string; also put it in the callback URL as `?token=…` |

### How the code differs (reference)
- `lib/gupshup.ts` — send via `https://api.gupshup.io/wa/api/v1/msg` + parse inbound JSON.
- `lib/wa-send.ts` — `sendWhatsApp()` dispatches to Twilio or Gupshup by `WHATSAPP_PROVIDER`.
- `app/api/whatsapp/webhook/route.ts` — when provider is Gupshup, reads inbound JSON and
  replies by **calling the send API** (Gupshup has no synchronous TwiML reply).

### Flip the switch
Once the number is `live` in Gupshup and the env vars are set, set
`WHATSAPP_PROVIDER=gupshup` and redeploy. Send `help` from your admin number to confirm.

## What changed for serverless (reference)
- `BotConversation` table — bot conversation state (was an in-memory `Map`).
- `lib/bookings.ts` — host/guest/cancel notifications use `next/server` `after()`.
- `instrumentation.ts` — boot timers now skip on Vercel (`process.env.VERCEL`); a
  persistent host still uses them.
- `vercel.json` — daily cron → `/api/cron/reminders`.
- `app/api/cron/reminders/route.ts` — accepts Vercel's `Authorization: Bearer <CRON_SECRET>`.
