import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reviewInputSchema } from "@/lib/validation";
import { getPlatformSettings } from "@/lib/settings";
import { hasCompletedStay } from "@/lib/reviews";
import { notifyAdminNewReview } from "@/lib/bookings";

// Guests submit a review for a published listing. Reviews start as PENDING and
// only appear publicly once an admin approves them.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to leave a review" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = reviewInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid review" },
      { status: 400 }
    );
  }

  const listing = await prisma.listing.findFirst({
    where: { id, status: "PUBLISHED" },
    select: { id: true, hostId: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.hostId === session.user.id) {
    return NextResponse.json(
      { error: "You can't review your own listing" },
      { status: 403 }
    );
  }

  // By default only guests who completed a stay can review; admin can open it up.
  const settings = await getPlatformSettings();
  if (!settings.reviewsOpenToAll && !(await hasCompletedStay(session.user.id, id))) {
    return NextResponse.json(
      { error: "Only guests who completed a stay here can leave a review." },
      { status: 403 }
    );
  }

  try {
    const review = await prisma.review.create({
      data: {
        listingId: id,
        authorId: session.user.id,
        rating: parsed.data.rating,
        body: parsed.data.body.trim(),
        status: "PENDING",
      },
    });
    notifyAdminNewReview(review.id); // WhatsApp the admin to moderate it
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "You've already reviewed this stay" },
        { status: 409 }
      );
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
