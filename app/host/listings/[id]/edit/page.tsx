import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { getFormAmenities, getFormBlocks, getCancellationPolicies } from "@/lib/data-access";
import { ListingForm } from "@/components/listing-form";

export const metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { images: { orderBy: { order: "asc" } }, amenities: true },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id && !session.user.isAdmin) redirect("/host");

  const [amenities, blocks, policies, settings] = await Promise.all([
    getFormAmenities(),
    getFormBlocks(),
    getCancellationPolicies(),
    getPlatformSettings(),
  ]);

  const order = ["FLEXIBLE", "MODERATE", "STRICT"];
  const sortedPolicies = [...policies].sort(
    (a, b) => order.indexOf(a.policy) - order.indexOf(b.policy)
  );

  // Map the listing's amenity ids back to keys for the form.
  const keyById = new Map(amenities.map((a) => [a.id, a.key]));
  const selectedAmenityKeys = listing.amenities
    .map((la) => keyById.get(la.amenityId))
    .filter((k): k is string => !!k);

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-2xl font-bold tracking-tight">Edit listing</h1>
      <p className="mt-1 text-muted-foreground">
        Saving changes sends the listing back to admin moderation.
      </p>
      <div className="mt-8">
        <ListingForm
          listingId={listing.id}
          amenities={amenities.map((a) => ({ key: a.key, label: a.label }))}
          blocks={blocks}
          policies={sortedPolicies.map((p) => ({
            policy: p.policy,
            title: p.title,
            description: p.description,
          }))}
          suggestedMinPaise={settings.suggestedPriceMin}
          suggestedMaxPaise={settings.suggestedPriceMax}
          initial={{
            title: listing.title,
            description: listing.description,
            hostDisplayName: listing.hostDisplayName ?? "",
            propertyType: listing.propertyType,
            roomType: listing.roomType,
            addressLine: listing.addressLine,
            city: listing.city,
            country: listing.country,
            flatNumber: listing.flatNumber ?? "",
            block: listing.block ?? "",
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            beds: listing.beds,
            maxGuests: listing.maxGuests,
            maxInfants: listing.maxInfants,
            basePriceRupees: Math.round(listing.basePrice / 100),
            monthlyPriceRupees: listing.monthlyPrice ? Math.round(listing.monthlyPrice / 100) : 0,
            cancellationPolicy: listing.cancellationPolicy,
            checkInTime: listing.checkInTime ?? "",
            checkOutTime: listing.checkOutTime ?? "",
            houseRules: listing.houseRules ?? "",
            amenityKeys: selectedAmenityKeys,
            imageUrls: listing.images.map((i) => i.url),
          }}
        />
      </div>
    </div>
  );
}
