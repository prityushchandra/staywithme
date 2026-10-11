import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { resolveReviewDate } from "@/lib/reviews";

const schema = z.object({
  listingId: z.string().min(1, "Choose a listing"),
  authorName: z
    .string()
    .trim()
    .min(2, "Enter the reviewer's name")
    .max(60, "Name is too long"),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  body: z
    .string()
    .trim()
    .min(3, "Write the review")
    .max(1000, "Review is too long"),
  // YYYY-MM-DD from the date input; defaults to now when omitted.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

// Admin posts a review on a guest's behalf. It carries no user account, only
// the name the admin typed, and goes live immediately.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid review" },
      { status: 400 }
    );
  }
  const { listingId, authorName, rating, body, date } = parsed.data;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const review = await prisma.review.create({
    data: {
      listingId,
      authorId: null,
      authorName,
      rating,
      body,
      status: "APPROVED",
      createdAt: resolveReviewDate(date),
    },
    select: { id: true },
  });

  // The public rating aggregates are cached in two layers; drop both so the
  // listing page shows the new average on the very next request.
  revalidateTag("reviews");
  clearMemo();

  return NextResponse.json({ ok: true, id: review.id, listingId });
}
