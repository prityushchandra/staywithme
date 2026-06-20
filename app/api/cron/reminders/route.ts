import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runCheckinReminders } from "@/lib/bookings";

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

// Sends the "3 days before check-in" reminders. On Vercel this is driven by a
// daily Cron (see vercel.json); on a persistent host the in-process timer in
// instrumentation.ts calls runCheckinReminders directly. You can also hit it
// manually. reminderSentAt dedups, so extra runs are safe.
//
// Auth: when CRON_SECRET is set we require it. Vercel Cron automatically sends
// it as `Authorization: Bearer <CRON_SECRET>`; we also accept ?key= / x-cron-key
// for manual/external triggers.
export const maxDuration = 60; // sending to many bookings can take a while

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? "";
    const ok = safeEqual(auth, `Bearer ${secret}`) || safeEqual(key, secret);
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Fail closed: an unset secret in prod would leave this message-sending
    // endpoint open to anyone (spam / cost). Require it to be configured.
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const sent = await runCheckinReminders();
  return NextResponse.json({ ok: true, sent });
}

export const POST = run;
export const GET = run;
