import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toggleSaved } from "@/lib/wishlist";
import { recordEvent } from "@/lib/analytics";

const schema = z.object({ listingId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to save" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Only allow saving listings that exist and are published.
  const listing = await prisma.listing.findFirst({
    where: { id: parsed.data.listingId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const saved = await toggleSaved(session.user.id, parsed.data.listingId);
  if (saved) {
    await recordEvent("WISHLIST_ADD", {
      listingId: parsed.data.listingId,
      userId: session.user.id,
    });
  }
  return NextResponse.json({ saved });
}
