import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Best-effort in-memory throttle to blunt phone-number enumeration. Serverless
// instances are per-region and recycle, so this caps bursts against a warm
// instance rather than acting as a hard global limit. The sign-in screen calls
// this once per attempt, so a low ceiling is plenty.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 15;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.resetAt < now) {
    if (hits.size > 1000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    hits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > RL_MAX;
}

/**
 * Lightweight "do you already have an account?" probe, used by the sign-in
 * screen to decide which form to show after the number step:
 *   • known number → "Welcome back" (no name to collect)
 *   • new number   → "Create your account" (collect a name)
 *
 * The number typed here ONLY selects which form is rendered — it grants no
 * access whatsoever. Identity is still proven by sending the login code from
 * that WhatsApp number, and the session is minted for the *verified sender*.
 * Only a first name is ever returned (never phone, email, roles or admin
 * flags), and the endpoint is rate limited per IP.
 */
export async function GET(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const empty = { exists: false, firstName: null as string | null };
  const phone = normalizePhone(new URL(req.url).searchParams.get("phone") ?? "");
  if (!phone) return NextResponse.json(empty);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { firstName: true, name: true },
  });
  if (!user) return NextResponse.json(empty);

  return NextResponse.json({
    exists: true,
    firstName: user.firstName ?? user.name?.split(/\s+/)[0] ?? null,
  });
}
