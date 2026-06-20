import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordEvent, isTrackableClientEvent } from "@/lib/analytics";

const schema = z.object({
  type: z.string(),
  listingId: z.string().min(1).max(40),
});

// Client event sink for VIEW and WHATSAPP_CLICK. Best-effort; never throws.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isTrackableClientEvent(parsed.data.type)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Only record events for a real, published listing — otherwise anyone could
  // POST junk/arbitrary ids to pollute analytics and game the ranking engine.
  const listing = await prisma.listing.findFirst({
    where: { id: parsed.data.listingId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!listing) return NextResponse.json({ ok: false }, { status: 400 });

  const session = await auth().catch(() => null);
  await recordEvent(parsed.data.type, {
    listingId: listing.id,
    userId: session?.user?.id,
  });
  return NextResponse.json({ ok: true });
}
