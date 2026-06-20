import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addBlock, removeBlock, toUtcDate } from "@/lib/availability";
import { clearMemo } from "@/lib/memo";

const createSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  kind: z.enum(["BOOKING", "MANUAL"]).default("MANUAL"),
  guestName: z.string().max(100).optional(),
  guests: z.coerce.number().int().min(1).max(50).optional(),
  note: z.string().max(300).optional(),
});

async function assertOwner(listingId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated", status: 401 as const };
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { hostId: true },
  });
  if (!listing) return { error: "Listing not found", status: 404 as const };
  if (listing.hostId !== session.user.id && !session.user.isAdmin) {
    return { error: "Not allowed", status: 403 as const };
  }
  return { session };
}

// Add a block / confirmed booking.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await assertOwner(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }

  const startDate = toUtcDate(parsed.data.startDate);
  const endDate = toUtcDate(parsed.data.endDate);
  if (endDate.getTime() <= startDate.getTime()) {
    return NextResponse.json(
      { error: "Check-out must be after check-in." },
      { status: 400 }
    );
  }

  const result = await addBlock({
    listingId: id,
    startDate,
    endDate,
    kind: parsed.data.kind,
    guestName: parsed.data.guestName,
    guests: parsed.data.guests,
    note: parsed.data.note,
    createdById: ctx.session.user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  // Blocking dates changes which listings are available for a date search —
  // bust the cached searches/listing reads, not just the in-process memo.
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ id: result.block.id }, { status: 201 });
}

// Remove a block: /api/listings/[id]/availability?blockId=...
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await assertOwner(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const blockId = new URL(req.url).searchParams.get("blockId");
  if (!blockId) return NextResponse.json({ error: "Missing blockId" }, { status: 400 });

  const block = await prisma.availabilityBlock.findUnique({ where: { id: blockId } });
  if (!block || block.listingId !== id) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }
  await removeBlock(blockId);
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
