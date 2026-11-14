"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { computePricing, getMonthlyStayOffer, formatINR, minimumStayMessage, nightlyPrice, strikePrice } from "@/lib/pricing";
import { SmartImage } from "@/components/smart-image";
import { WishlistButton } from "@/components/wishlist-button";
import { useSearchDates } from "@/components/search-dates-context";
import type { ListingCardData } from "@/lib/data-access";
import { HomepageListingToggle } from "@/components/admin/homepage-listing-controls";

// Listing card. Shows only the cover photo (swiping through all photos happens
// on the listing detail page). All displayed prices include the Platform Fee.
export function ListingCard({
  listing,
  platformFeePercent,
  rating,
  showVisibilityToggle = false,
}: {
  listing: ListingCardData;
  platformFeePercent: number;
  rating?: { average: number; count: number };
  showVisibilityToggle?: boolean;
}) {
  const { total } = computePricing(nightlyPrice(listing), { platformFeePercent });
  const strike = strikePrice(listing);
  // Both figures are guest-facing totals, so the % off a guest reads on the
  // badge matches the two numbers printed right below it.
  const strikeTotal = strike
    ? computePricing(strike, { platformFeePercent }).total
    : null;
  const percentOff = strikeTotal
    ? Math.floor(((strikeTotal - total) / strikeTotal) * 100)
    : 0;
  const cover = listing.cover;

  // Carry the dates/guests chosen in the search bar into the listing link.
  const searchDates = useSearchDates();
  const monthlyOffer = getMonthlyStayOffer(listing, { platformFeePercent });
  const hasMonthlyDiscount = !!monthlyOffer?.savings || (!!listing.minimumNights && !!listing.monthlyStayDiscount);
  const href = `/listings/${listing.id}${
    searchDates?.query ? `?${searchDates.query}` : ""
  }`;

  return (
    <div className="group flex h-full flex-col duration-500 animate-in fade-in slide-in-from-bottom-2">
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow duration-300 ease-ios group-hover:shadow-lg">
        <Link href={href} className="absolute inset-0 z-0">
          {cover ? (
            <SmartImage
              src={cover}
              alt={listing.title}
              fill
              sizes="(max-width: 768px) 100vw, 25vw"
              className="object-cover transition-transform duration-500 ease-ios group-hover:scale-[1.06]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No photo
            </div>
          )}
        </Link>
        <div className="pointer-events-none absolute left-2 right-12 top-2 z-10 flex flex-wrap gap-1">
          {hasMonthlyDiscount && (
            <span className="rounded-full bg-brand-dark px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
              {monthlyOffer?.savingsPercent ? `${monthlyOffer.savingsPercent}% off monthly stays` : "Monthly stays discount"}
            </span>
          )}
          {percentOff > 0 && (
            <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
              {percentOff}% off per night
            </span>
          )}
        </div>
        <div className="absolute right-2 top-2 z-10">
          <WishlistButton listingId={listing.id} />
        </div>
      </div>

      {/* Grows to fill the row so the price line stays aligned across cards
          even when titles wrap to different numbers of lines. */}
      <Link href={href} className="mt-2 flex flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-medium leading-snug">
            {listing.title}
          </h3>
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 fill-current" />{" "}
            {rating && rating.count > 0 ? rating.average : "New"}
          </span>
        </div>
        {listing.minimumNights && <p className="my-1 text-xs text-muted-foreground">{minimumStayMessage(listing.minimumNights)}</p>}
        <p className="mt-auto pt-0.5 text-sm">
          {strikeTotal ? (
            <span className="mr-1 text-muted-foreground line-through">
              {formatINR(strikeTotal)}
            </span>
          ) : null}
          <span
            className={
              strikeTotal
                ? "font-semibold text-rose-600 underline"
                : "font-semibold underline"
            }
          >
            {formatINR(total)}
          </span>
          <span className="text-muted-foreground">
            {" / night"}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Includes Platform Fee
        </p>
      </Link>
      {showVisibilityToggle && <HomepageListingToggle listingId={listing.id} />}
    </div>
  );
}
