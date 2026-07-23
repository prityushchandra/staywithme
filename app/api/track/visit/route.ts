import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { recordEvent } from "@/lib/analytics";

const schema = z.object({ path: z.string().max(512).optional() });

// Anonymous "landing" sink — one row per browser session (see <TrackVisit/>).
// Best-effort; never throws. Identity is the httpOnly swm_vid cookie set by the
// middleware, so a browser can't spoof another visitor's id. Logged-in visits
// also carry the userId, which powers the "landed → signed up" conversion.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  const path = parsed.success ? parsed.data.path : undefined;

  const jar = await cookies();
  const visitorId = jar.get("swm_vid")?.value;
  // No cookie yet (very first hop, or a client that strips cookies) — skip
  // rather than record an unattributable row.
  if (!visitorId) return NextResponse.json({ ok: true });

  const session = await auth().catch(() => null);
  await recordEvent("PAGE_VIEW", {
    visitorId,
    userId: session?.user?.id,
    metadata: path ? { path } : undefined,
  });

  return NextResponse.json({ ok: true });
}
