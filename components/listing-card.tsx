"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { computePricing, formatINR } from "@/lib/pricing";
import { SmartImage } from "@/components/smart-image";
import { WishlistButton } from "@/components/wishlist-button";
import { useSearchDates } from "@/components/search-dates-context";
import type { PublicListing } from "@/lib/data-access";

// Listing card. Shows only the cover photo (swiping through all photos happens
// on the listing detail page). Price is the guest-facing TOTAL per night.
export function ListingCard({
  listing,
  platformFeePercent,
  rating,
}: {
  listing: PublicListing;
  platformFeePercent: number;
  rating?: { average: number; count: number };
}) {
  const { total } = computePricing(listing.basePrice, { platformFeePercent });
  const cover = listing.images[0]?.url;

  // Carry the dates/guests chosen in the search bar into the listing link.
  const searchDates = useSearchDates();
  const href = `/listings/${listing.id}${
    searchDates?.query ? `?${searchDates.query}` : ""
  }`;

  return (
    <div className="group block duration-500 animate-in fade-in slide-in-from-bottom-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow duration-300 ease-ios group-hover:shadow-lg">
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
        <div className="absolute right-2 top-2 z-10">
          <WishlistButton listingId={listing.id} />
        </div>
      </div>

      <Link href={href} className="mt-2 block space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-medium">{listing.title}</h3>
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 fill-current" />{" "}
            {rating && rating.count > 0 ? rating.average : "New"}
          </span>
        </div>
        <p className="text-sm">
          <span className="font-semibold underline">{formatINR(total)}</span>
          <span className="text-muted-foreground"> for 1 night</span>
        </p>
      </Link>
    </div>
  );
}
