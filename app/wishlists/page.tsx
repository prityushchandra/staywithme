import Link from "next/link";
import { Heart } from "lucide-react";
import { auth } from "@/lib/auth";
import { getSavedListingIds } from "@/lib/wishlist";
import { getPublishedListingsByIds } from "@/lib/data-access";
import { getPlatformSettings } from "@/lib/settings";
import { getRatingSummaries } from "@/lib/reviews";
import { ListingCard } from "@/components/listing-card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Wishlist" };
export const dynamic = "force-dynamic";

export default async function WishlistsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="container max-w-md py-16 text-center">
        <Heart className="mx-auto h-10 w-10 text-brand" />
        <h1 className="mt-4 text-xl font-bold">Save your favourite stays</h1>
        <p className="mt-1 text-muted-foreground">
          Sign in to create your wishlist and keep places you love in one spot.
        </p>
        <Button asChild variant="brand" className="mt-4">
          <Link href="/sign-in?callbackUrl=/wishlists">Sign in</Link>
        </Button>
      </div>
    );
  }

  const ids = await getSavedListingIds(session.user.id);
  const [listings, settings] = await Promise.all([
    getPublishedListingsByIds(ids),
    getPlatformSettings(),
  ]);
  const ratings = await getRatingSummaries(listings.map((l) => l.id));

  return (
    <div className="container py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Your wishlist</h1>
      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          Nothing saved yet. Tap the{" "}
          <Heart className="inline h-4 w-4" /> on any stay to save it here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              platformFeePercent={settings.platformFeePercent}
              rating={ratings.get(listing.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
