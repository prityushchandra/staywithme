import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { Bath, BedDouble, BedSingle, MapPin, Sparkles, Star, UsersRound } from "lucide-react";
import { getPublishedListingById, getListingByIdAnyStatus } from "@/lib/data-access";
import { getPlatformSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { razorpayConfigured } from "@/lib/razorpay";
import { InquiryPanel } from "@/components/inquiry-panel";
import { Gallery } from "@/components/gallery";
import { WishlistButton } from "@/components/wishlist-button";
import { ShareButton } from "@/components/share-button";
import { TrackView } from "@/components/track-view";
import { getActiveBlocks } from "@/lib/availability";
import { syncListingCalendar } from "@/lib/calendar-sync";
import { getApprovedReviews, getRatingSummary, hasCompletedStay, reviewDisplayName } from "@/lib/reviews";
import { relativeTime } from "@/lib/relative-time";
import { ReviewList } from "@/components/review-list";
import { ReviewForm } from "@/components/review-form";
import { BookingProvider } from "@/components/booking-context";
import { AmenitiesList } from "@/components/amenities-list";
import { CollapsibleText } from "@/components/collapsible-text";
import { MapPreview } from "@/components/map-preview";
import { MobileBookingBar } from "@/components/mobile-booking-bar";
import { ListingFaqs } from "@/components/listing-faqs";
import { listingFaqsSchema } from "@/lib/validation";

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

  // Refresh the Airbnb calendar before reading blocks. We already loaded the
  // listing row (which carries icalUrl/icalSyncedAt), so deciding this needs no
  // extra query. Managers get an immediate awaited sync; guests never block first
  // paint — the external fetch runs via after() and appears on the next load.
  const isManager = !!session?.user?.isAdmin || listing.host.id === session?.user?.id;
  if (listing.icalUrl) {
    const maxAgeMs = isManager ? 0 : 60_000;
    const stale =
      !listing.icalSyncedAt ||
      Date.now() - listing.icalSyncedAt.getTime() >= maxAgeMs;
    if (stale) {
      if (isManager) {
        await syncListingCalendar(id).catch(() => {});
      } else {
        after(() => {
          syncListingCalendar(id).catch(() => {});
        });
      }
    }
  }

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
  // Only offer "book with us" when the gateway is actually wired up; otherwise
  // the whole flow degrades to the WhatsApp enquiry it has always been.
  const canPayOnline = razorpayConfigured();
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
  const faqs = listingFaqsSchema.parse(listing.faqs);
  const [headline, ...titleDetails] = listing.title.split("|").map((part) => part.trim()).filter(Boolean);
  const stayDetails = [
    { icon: UsersRound, value: listing.maxGuests, label: listing.maxGuests === 1 ? "Guest" : "Guests" },
    { icon: BedDouble, value: listing.bedrooms, label: listing.bedrooms === 1 ? "Bedroom" : "Bedrooms" },
    { icon: BedSingle, value: listing.beds, label: listing.beds === 1 ? "Bed" : "Beds" },
    { icon: Bath, value: listing.bathrooms, label: listing.bathrooms === 1 ? "Bathroom" : "Bathrooms" },
  ];

  // Relative timestamps are resolved here rather than in the client component:
  // the page is force-dynamic, so a value fixed at request time stays stable for
  // the life of the HTML instead of drifting during hydration.
  const now = new Date();
  const reviewItems = reviews.map((r) => ({
    id: r.id,
    name: reviewDisplayName(r),
    rating: r.rating,
    body: r.body,
    timeAgo: relativeTime(r.createdAt, now),
  }));

  return (
    <div className="container pb-28 pt-5 sm:pt-8 lg:pb-12">
      {!isPreview && <TrackView listingId={listing.id} />}
      {isPreview && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Preview — this listing is{" "}
          <strong>{listing.status.toLowerCase()}</strong> and isn&apos;t publicly
          visible yet.
        </div>
      )}

      <header className="mb-6 sm:mb-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>{listing.city}, {listing.country}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1 rounded-full border border-foreground/10 bg-card/70 p-1">
            <ShareButton title={listing.title} />
            <WishlistButton
              listingId={listing.id}
              showLabel
              className="min-h-11 min-w-11 gap-2 px-3 text-sm font-medium hover:bg-foreground/5"
            />
          </div>
        </div>
        <h1 className="max-w-4xl break-words font-serif text-[2rem] leading-[1.15] tracking-tight [text-wrap:balance] sm:text-5xl">
          {headline || listing.title}
        </h1>
        {titleDetails.length > 0 && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {titleDetails.join(" · ")}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm">
          {ratingSummary.count > 0 ? (
            <a href="#reviews" className="inline-flex min-h-8 items-center gap-1.5 rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">
              <Star aria-hidden="true" className="h-3.5 w-3.5 fill-current text-foreground" />
              <span className="font-semibold">{ratingSummary.average}</span>
              <span className="text-muted-foreground">({plural(ratingSummary.count, "review")})</span>
            </a>
          ) : (
            <span className="text-muted-foreground">New stay</span>
          )}
          {listing.guestFavorite && (
            <span className="inline-flex items-center gap-1.5 text-brand-dark">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Guest favourite
            </span>
          )}
          <span className="text-muted-foreground">{ROOM_TYPE_LABEL[listing.roomType]}</span>
        </div>
      </header>

      <Gallery images={galleryImages} title={listing.title} />

      <nav aria-label="Explore this stay" className="mt-4 flex gap-6 overflow-x-auto border-b border-foreground/10 text-sm text-muted-foreground sm:mt-6 sm:gap-8">
        {[
          { href: "#about", label: "About" },
          { href: "#amenities", label: "Amenities" },
          ...(listing.mapsUrl ? [{ href: "#location", label: "Location" }] : []),
          { href: "#reviews", label: "Reviews" },
          ...(faqs.length > 0 ? [{ href: "#faqs", label: "FAQs" }] : []),
        ].map((section) => (
          <a key={section.href} href={section.href} className="shrink-0 border-b-2 border-transparent py-4 font-medium outline-none transition-colors hover:border-brand hover:text-foreground focus-visible:border-brand focus-visible:text-foreground">
            {section.label}
          </a>
        ))}
      </nav>

      <BookingProvider
        initialCheckIn={sp.checkIn ?? ""}
        initialCheckOut={sp.checkOut ?? ""}
        initialGuests={initialGuests}
        blockedRanges={serializedBlocks}
      >
        <div className="mt-8 grid grid-cols-1 gap-x-14 gap-y-10 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:gap-x-20">
          {/* Left: details */}
          <div className="min-w-0">
            {/* Place summary. Host identity is intentionally NOT shown to guests. */}
            <section className="pb-8 sm:pb-10">
              <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">
                {ROOM_TYPE_LABEL[listing.roomType]}
              </h2>
              <div className="mt-6 grid grid-cols-4 divide-x divide-foreground/10 rounded-2xl bg-card/70 py-5">
                {stayDetails.map(({ icon: Icon, value, label }) => (
                  <div key={label} className="flex min-w-0 flex-col items-center px-1 text-center">
                    <Icon aria-hidden="true" className="mb-2.5 h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                    <span className="text-lg font-medium leading-none">{value}</span>
                    <span className="mt-1.5 text-[11px] text-muted-foreground sm:text-xs">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* About */}
            <section id="about" className="scroll-mt-28 border-t border-foreground/10 py-9 sm:py-11">
              <h2 className="mb-4 font-serif text-2xl tracking-tight sm:text-3xl">About this place</h2>
              <CollapsibleText text={listing.description} className="leading-7" />
            </section>

            {/* Amenities */}
            <section id="amenities" className="scroll-mt-28 border-t border-foreground/10 py-9 sm:py-11">
              <h2 className="mb-5 font-serif text-2xl tracking-tight sm:text-3xl">
                What this place offers
              </h2>
              <AmenitiesList amenities={amenities} />
            </section>

            {/* Where you'll be — renders only when an admin has added a map link */}
            {listing.mapsUrl && (
              <section id="location" className="scroll-mt-28 border-t border-foreground/10 py-9 sm:py-11">
                <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">Where you&apos;ll be</h2>
                <p className="mb-5 mt-3 text-sm leading-relaxed text-muted-foreground">
                  Tap the map to open the exact location in Google Maps.
                </p>
                <MapPreview
                  mapsUrl={listing.mapsUrl}
                  address={`${listing.city}, ${listing.country}`}
                  locality={`${listing.city}, ${listing.country}`}
                />
              </section>
            )}

            {/* Reviews */}
            <section id="reviews" className="scroll-mt-28 border-t border-foreground/10 py-9 sm:py-11">
              <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">
                {ratingSummary.count > 0 ? "Words from our guests" : "Guest reviews"}
              </h2>
              {ratingSummary.count > 0 && (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Star aria-hidden="true" className="h-4 w-4 fill-current text-foreground" />
                  {ratingLabel}
                </p>
              )}
              <div className="mt-6 space-y-6">
                <ReviewList reviews={reviewItems} />
                {canReview && <ReviewForm listingId={listing.id} />}
              </div>
            </section>

            <ListingFaqs faqs={faqs} />

            {/* Things to know */}
            <section className="border-t border-foreground/10 py-9 sm:py-11">
              <h2 className="mb-6 font-serif text-2xl tracking-tight sm:text-3xl">Things to know</h2>
              <div className="mb-7 grid grid-cols-2 gap-4 rounded-2xl bg-card/70 p-5">
                <div>
                  <p className="text-xs text-muted-foreground">Check-in</p>
                  <p className="mt-1 text-sm font-semibold">{listing.checkInTime?.trim() || "Flexible"}</p>
                </div>
                <div className="border-l border-foreground/10 pl-5">
                  <p className="text-xs text-muted-foreground">Checkout</p>
                  <p className="mt-1 text-sm font-semibold">{listing.checkOutTime?.trim() || "Flexible"}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                <div>
                  <h4 className="mb-3 font-medium">House rules</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
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
          <div id="book" className="min-w-0 scroll-mt-24">
            <InquiryPanel
              propertyId={listing.id}
              refCode={listing.refCode ?? undefined}
              propertyName={listing.title}
              basePrice={listing.basePrice}
              discountedPrice={listing.discountedPrice}
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
              airbnbUrl={listing.airbnbUrl}
              canPayOnline={canPayOnline}
            />
          </div>
        </div>

        {/* Mobile-only sticky CTA bar */}
        <MobileBookingBar
          basePrice={listing.basePrice}
          discountedPrice={listing.discountedPrice}
          monthlyPrice={listing.monthlyPrice}
          platformFeePercent={settings.platformFeePercent}
          blockedRanges={serializedBlocks}
        />
      </BookingProvider>
    </div>
  );
}
