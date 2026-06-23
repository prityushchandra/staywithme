import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { isSafeIcalUrl } from "@/lib/ical";
import { syncListingCalendar } from "@/lib/calendar-sync";

// Owner (or admin) only. Mirrors the loadOwned guard used by the listing routes.
async function loadOwned(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated", status: 401 as const };
  const listing = await prisma.listing.findUnique({ where: { id }, select: { id: true, hostId: true } });
  if (!listing) return { error: "Listing not found", status: 404 as const };
  if (listing.hostId !== session.user.id && !session.user.isAdmin)
    return { error: "Not allowed", status: 403 as const };
  return { listing };
}

const schema = z.object({ icalUrl: z.string().trim().min(1).max(2000) });

// Save the calendar link and sync immediately.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadOwned(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a calendar link." }, { status: 400 });

  const icalUrl = parsed.data.icalUrl.trim();
  if (!isSafeIcalUrl(icalUrl))
    return NextResponse.json({ error: "Use the full https calendar (.ics) link." }, { status: 400 });

  await prisma.listing.update({ where: { id }, data: { icalUrl, icalError: null } });
  const result = await syncListingCalendar(id);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  const updated = await prisma.listing.findUnique({
    where: { id },
    select: { icalSyncedAt: true },
  });
  return NextResponse.json({ ok: true, count: result.count, syncedAt: updated?.icalSyncedAt });
}

// Remove the link and its imported blocks.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadOwned(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  await prisma.$transaction([
    prisma.availabilityBlock.deleteMany({ where: { listingId: id, kind: "ICAL" } }),
    prisma.listing.update({
      where: { id },
      data: { icalUrl: null, icalSyncedAt: null, icalError: null },
    }),
  ]);
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
