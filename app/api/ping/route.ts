import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Keep-warm endpoint. Point a free uptime monitor (UptimeRobot / cron-job.org)
// at this every ~5 minutes to keep BOTH the serverless function and the Neon
// database awake. Free-tier Neon auto-suspends after ~5 min idle and takes
// ~0.5–2s to wake — that cold wake is the main cause of slow first loads on
// production. A lightweight SELECT 1 keeps it from sleeping.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, ts: Date.now() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
