import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { clearMemo } from "@/lib/memo";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.discriminatedUnion("action", [
  z.object({
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
  }),
  z.object({
    action: z.literal("setVisibility"),
    visible: z.boolean(),
  }),
]);

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

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  let isVisible: boolean | undefined;
  switch (parsed.data.action) {
    case "setVisibility": {
      if (listing.status !== "PUBLISHED") {
        return NextResponse.json({ error: "Publish this listing before changing its visibility." }, { status: 409 });
      }
      try {
        const updated = await prisma.listing.update({
          where: { id, status: "PUBLISHED" },
          data: { isVisible: parsed.data.visible },
          select: { isVisible: true },
        });
        isVisible = updated.isVisible;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          return NextResponse.json({ error: "This listing is no longer published. Refresh and try again." }, { status: 409 });
        }
        console.error("[admin-listings] visibility change failed", {
          code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UNKNOWN",
        });
        return NextResponse.json({ error: "Could not update listing visibility. Please retry." }, { status: 500 });
      }
      break;
    }
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
  if (parsed.data.action === "setVisibility") {
    revalidatePath("/");
    revalidatePath("/search");
  }
  return NextResponse.json({ ok: true, ...(isVisible !== undefined ? { isVisible } : {}) });
}

// Permanently delete a listing (admin only). Cascades to its images, amenities,
// reviews, etc. via the schema relations.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  await prisma.listing.delete({ where: { id } });
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
