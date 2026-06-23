import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { Star } from "lucide-react";
import { getPublishedListingById, getListingByIdAnyStatus } from "@/lib/data-access";
import { getPlatformSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { InquiryPanel } from "@/components/inquiry-panel";
import { Gallery } from "@/components/gallery";
import { WishlistButton } from "@/components/wishlist-button";
import { TrackView } from "@/components/track-view";
import { getActiveBlocks } from "@/lib/availability";
import { syncListingCalendarIfStale } from "@/lib/calendar-sync";
import { getApprovedReviews, getRatingSummary, hasCompletedStay } from "@/lib/reviews";
import { ReviewList } from "@/components/review-list";
import { ReviewForm } from "@/components/review-form";
import { BookingProvider } from "@/components/booking-context";
import { AvailabilitySection } from "@/components/availability-section";
import { AmenitiesList } from "@/components/amenities-list";
import { MobileBookingBar } from "@/components/mobile-booking-bar";

export const dynamic = "force-dynamic";

const ROOM_TYPE_LABEL: Record<string, string> = {
  ENTIRE: "Entire place",
  PRIVATE: "Private room",
  SHARED: "Shared room",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getPublishedListingById(id);
  if (!listing) return { title: "Listing not found" };
  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    openGraph: {
      title: listing.title,
      images: listing.images[0]?.url ? [listing.images[0].url] : [],
    },
  };
}

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkIn?: string; checkOut?: string; guests?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [listing, settings, session] = await Promise.all([
    getListingByIdAnyStatus(id),
    getPlatformSettings(),
    auth(),
  ]);

  if (!listing) notFound();

  // Gate on the CURRENT status. Public visitors only see published listings;
  // admins and the owning host can preview a not-yet-published one.
  const isPublished = listing.status === "PUBLISHED";
  const canView =
    isPublished ||
    !!session?.user?.isAdmin ||
    listing.host.id === session?.user?.id;
  if (!canView) notFound();
  const isPreview = !isPublished;

  // Refresh the Airbnb calendar in the background (if stale) so the guest-facing
  // availability converges without slowing this page. Runs after the response.
  after(() => syncListingCalendarIfStale(id, 120_000));

  const [policyText, blocks, reviews, ratingSummary] = await Promise.all([
    prisma.cancellationPolicyText.findUnique({
      where: { policy: listing.cancellationPolicy },
    }),
    getActiveBlocks(id),
    getApprovedReviews(id),
    getRatingSummary(id),
  ]);

  const userId = session?.user?.id;
  const isAuthenticated = Boolean(userId);
  // Only a guest who actually completed a stay here may review — unless an admin
  // has opened reviews to everyone. Either way, anyone can READ the reviews below.
  const isGuestViewer = Boolean(userId) && userId !== listing.host.id;
  const canReview =
    isGuestViewer &&
    (settings.reviewsOpenToAll || (await hasCompletedStay(userId!, id)));
  const guestName = session?.user?.name ?? session?.user?.email ?? "";
  // Read the phone from the DB (not the session token, which may pre-date the
  // field) so the enquiry always carries the guest's number.
  const guestPhone = userId
    ? (await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }))?.phone ?? undefined
    : undefined;
  const initialGuests = Math.min(
    listing.maxGuests,
    Math.max(1, Number(sp.guests) || 1)
  );

  const galleryImages = listing.images.map((i) => ({ id: i.id, url: i.url }));
  const serializedBlocks = blocks.map((b) => ({
    startDate: b.startDate.toISOString(),
    endDate: b.endDate.toISOString(),
  }));
  const amenities = listing.amenities.map(({ amenity }) => ({
    id: amenity.id,
    label: amenity.label,
    icon: amenity.icon,
  }));
  const houseRules = (listing.houseRules ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const ratingLabel =
    ratingSummary.count > 0
      ? `${ratingSummary.average} · ${plural(ratingSummary.count, "review")}`
      : "New";

  return (
    <div className="container pb-28 pt-6 lg:pb-6">
      {!isPreview && <TrackView listingId={listing.id} />}
      {isPreview && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Preview — this listing is{" "}
          <strong>{listing.status.toLowerCase()}</strong> and isn&apos;t publicly
          visible yet.
        </div>
      )}

      {/* Title + meta */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {listing.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <a
              href="#reviews"
              className="flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <Star className="h-4 w-4 fill-current text-amber-500" /> {ratingLabel}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-muted">
          <WishlistButton listingId={listing.id} size="lg" />
          <span className="text-sm font-medium underline">Save</span>
        </div>
      </div>

      <Gallery images={galleryImages} title={listing.title} />

      <BookingProvider
        initialCheckIn={sp.checkIn ?? ""}
        initialCheckOut={sp.checkOut ?? ""}
        initialGuests={initialGuests}
      >
        <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-3">
          {/* Left: details */}
          <div className="lg:col-span-2">
            {/* Place summary. Host identity is intentionally NOT shown to guests. */}
            <section className="border-b pb-6">
              <h2 className="text-xl font-semibold sm:text-2xl">
                {ROOM_TYPE_LABEL[listing.roomType]}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {plural(listing.maxGuests, "guest")} ·{" "}
                {plural(listing.bedrooms, "bedroom")} ·{" "}
                {plural(listing.beds, "bed")} ·{" "}
                {plural(listing.bathrooms, "bath")}
              </p>
            </section>

            {/* About */}
            <section className="border-b py-6">
              <h3 className="mb-2 text-lg font-semibold">About this place</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {listing.description}
              </p>
            </section>

            {/* Amenities */}
            <section className="border-b py-6">
              <h3 className="mb-2 text-lg font-semibold">
                What this place offers
              </h3>
              <AmenitiesList amenities={amenities} />
            </section>

            {/* Availability calendar (interactive, synced with the booking card) */}
            <section className="border-b py-6">
              <AvailabilitySection blockedRanges={serializedBlocks} />
            </section>

            {/* Reviews */}
            <section id="reviews" className="scroll-mt-24 border-b py-6">
              <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
                <Star className="h-5 w-5 fill-current text-amber-500" />
                {ratingSummary.count > 0 ? ratingLabel : "Reviews"}
              </h3>
              <div className="mt-4 space-y-6">
                <ReviewList reviews={reviews} />
                {canReview && <ReviewForm listingId={listing.id} />}
              </div>
            </section>

            {/* Things to know */}
            <section className="py-6">
              <h3 className="mb-5 text-lg font-semibold">Things to know</h3>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                <div>
                  <h4 className="mb-3 font-medium">House rules</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>Check-in: {listing.checkInTime?.trim() || "Flexible"}</li>
                    <li>Checkout: {listing.checkOutTime?.trim() || "Flexible"}</li>
                    <li>{plural(listing.maxGuests, "guest")} maximum</li>
                    {houseRules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3 font-medium">Cancellation policy</h4>
                  <p className="text-sm font-medium text-foreground">
                    {policyText?.title ?? listing.cancellationPolicy}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {policyText?.description ??
                      "Cancellation terms are confirmed with the platform over WhatsApp."}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Right: booking card */}
          <div id="book" className="lg:col-span-1">
            <InquiryPanel
              propertyId={listing.id}
              refCode={listing.refCode ?? undefined}
              propertyName={listing.title}
              basePrice={listing.basePrice}
              monthlyPrice={listing.monthlyPrice}
              platformFeePercent={settings.platformFeePercent}
              maxGuests={listing.maxGuests}
              maxInfants={listing.maxInfants}
              whatsappNumber={settings.whatsappNumber}
              guestName={guestName}
              guestPhone={guestPhone}
              checkInTime={listing.checkInTime ?? undefined}
              checkOutTime={listing.checkOutTime ?? undefined}
              blockedRanges={serializedBlocks}
              isAuthenticated={isAuthenticated}
            />
          </div>
        </div>

        {/* Mobile-only sticky CTA bar */}
        <MobileBookingBar
          basePrice={listing.basePrice}
          monthlyPrice={listing.monthlyPrice}
          platformFeePercent={settings.platformFeePercent}
          blockedRanges={serializedBlocks}
        />
      </BookingProvider>
    </div>
  );
}
