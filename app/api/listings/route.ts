import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listingInputSchema } from "@/lib/validation";
import { getAmenityIdByKey } from "@/lib/search";
import { createUniqueRefCode } from "@/lib/refcode";
import { notifyAdminNewListing } from "@/lib/bookings";

// Create a listing. Any signed-in user may list a property — doing so makes
// them a host. New listings enter the moderation queue as PENDING.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = listingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // Resolve amenity ids from keys via the cached map (ignore unknown keys).
  const amenityMap = await getAmenityIdByKey();
  const amenityIds = d.amenityKeys
    .map((k) => amenityMap[k])
    .filter((id): id is string => !!id);

  const refCode = await createUniqueRefCode();
  const listing = await prisma.listing.create({
    data: {
      hostId: session.user.id,
      refCode,
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
      basePrice: d.basePriceRupees * 100, // rupees -> paise
      monthlyPrice: d.monthlyPriceRupees > 0 ? d.monthlyPriceRupees * 100 : null,
      cancellationPolicy: d.cancellationPolicy,
      checkInTime: d.checkInTime || null,
      checkOutTime: d.checkOutTime || null,
      houseRules: d.houseRules || null,
      status: "PENDING", // submitted for admin approval
      images: {
        create: d.imageUrls.map((url, idx) => ({
          url,
          order: idx,
          isCover: idx === 0,
        })),
      },
      amenities: { create: amenityIds.map((id) => ({ amenityId: id })) },
    },
  });

  // Listing your first property makes you a host (recorded for correctness;
  // the UI lets any signed-in user reach the create flow regardless).
  if (!session.user.roles?.includes("HOST")) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { roles: { set: [...new Set([...(session.user.roles ?? ["GUEST"]), "HOST"])] } },
    });
  }

  revalidateTag("listings");
  clearMemo();
  notifyAdminNewListing(listing.id); // WhatsApp the admin to review it
  return NextResponse.json({ id: listing.id }, { status: 201 });
}
