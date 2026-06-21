import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listingInputSchema } from "@/lib/validation";
import { getAmenityIdByKey } from "@/lib/search";
import { notifyAdminListingUpdated } from "@/lib/bookings";

async function loadOwned(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated", status: 401 as const };
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) return { error: "Listing not found", status: 404 as const };
  const owns = listing.hostId === session.user.id || session.user.isAdmin;
  if (!owns) return { error: "Not allowed", status: 403 as const };
  return { listing, session };
}

// Edit a listing. Editing a PUBLISHED/APPROVED listing returns it to PENDING.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await loadOwned(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const parsed = listingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const amenityMap = await getAmenityIdByKey();
  const amenityIds = d.amenityKeys
    .map((k) => amenityMap[k])
    .filter((id): id is string => !!id);

  await prisma.$transaction([
    prisma.listingImage.deleteMany({ where: { listingId: id } }),
    prisma.listingAmenity.deleteMany({ where: { listingId: id } }),
    prisma.listing.update({
      where: { id },
      data: {
        title: d.title,
        description: d.description,
        hostDisplayName: d.hostDisplayName || null,
        propertyType: d.propertyType,
        roomType: d.roomType,
        addressLine: d.addressLine,
        city: d.city,
        country: d.country,
        flatNumber: d.flatNumber,
        block: d.block,
        bedrooms: d.bedrooms,
        bathrooms: d.bathrooms,
        beds: d.beds,
        maxGuests: d.maxGuests,
        maxInfants: d.maxInfants,
        basePrice: d.basePriceRupees * 100,
        monthlyPrice: d.monthlyPriceRupees > 0 ? d.monthlyPriceRupees * 100 : null,
        cancellationPolicy: d.cancellationPolicy,
        checkInTime: d.checkInTime || null,
        checkOutTime: d.checkOutTime || null,
        houseRules: d.houseRules || null,
        // Any edit re-enters moderation; clears a prior rejection reason.
        status: "PENDING",
        rejectionReason: null,
        images: {
          create: d.imageUrls.map((url, idx) => ({
            url,
            order: idx,
            isCover: idx === 0,
          })),
        },
        amenities: { create: amenityIds.map((id) => ({ amenityId: id })) },
      },
    }),
  ]);

  revalidateTag("listings");
  clearMemo();
  // Tell the admin a host edited their listing (so it gets re-reviewed). Skip
  // when the admin is the one editing — no point notifying yourself.
  if (!ctx.session.user.isAdmin) notifyAdminListingUpdated(id);
  return NextResponse.json({ id, status: "PENDING" });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await loadOwned(id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  await prisma.listing.delete({ where: { id } });
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
