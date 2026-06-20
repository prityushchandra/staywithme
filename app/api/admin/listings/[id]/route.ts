import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  action: z.enum([
    "approve",
    "reject",
    "unpublish",
    "feature",
    "unfeature",
    "setHostName",
  ]),
  reason: z.string().max(500).optional(),
  hostDisplayName: z.string().trim().max(50).optional(),
});

// Admin moderation actions on a listing.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  switch (parsed.data.action) {
    case "approve":
      await prisma.listing.update({
        where: { id },
        data: { status: "PUBLISHED", rejectionReason: null },
      });
      break;
    case "reject":
      await prisma.listing.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectionReason: parsed.data.reason?.trim() || "Did not meet guidelines.",
        },
      });
      break;
    case "unpublish":
      await prisma.listing.update({
        where: { id },
        data: { status: "PENDING", featured: false },
      });
      break;
    case "feature":
      await prisma.listing.update({ where: { id }, data: { featured: true } });
      break;
    case "unfeature":
      await prisma.listing.update({ where: { id }, data: { featured: false } });
      break;
    case "setHostName":
      await prisma.listing.update({
        where: { id },
        data: { hostDisplayName: parsed.data.hostDisplayName?.trim() || null },
      });
      break;
  }

  // Moderation changes which listings are public / featured.
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
