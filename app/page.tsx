import { getPublishedListings, getFeaturedListings } from "@/lib/data-access";
import { getPlatformSettings } from "@/lib/settings";
import { getRatingSummaries } from "@/lib/reviews";
import { ListingCard } from "@/components/listing-card";
import { SearchBar } from "@/components/search-bar";
import { SearchDatesProvider } from "@/components/search-dates-context";

// The homepage output is identical for every visitor (wishlist/session state is
// resolved client-side), so we cache the rendered page and refresh it in the
// background instead of re-rendering ~1MB of inline photos on every request.
// New/approved listings appear within `revalidate` seconds.
export const revalidate = 60;

export default async function HomePage() {
  const [listings, featured, settings] = await Promise.all([
    getPublishedListings({ take: 24 }),
    getFeaturedListings(8),
    getPlatformSettings(),
  ]);

  const ratings = await getRatingSummaries([
    ...new Set([...listings, ...featured].map((l) => l.id)),
  ]);

  // Don't repeat featured listings in the main grid — rendering the same photos
  // twice doubles the page weight for no benefit.
  const featuredIds = new Set(featured.map((l) => l.id));
  const rest = listings.filter((l) => !featuredIds.has(l.id));

  return (
    <SearchDatesProvider>
      {/* Hero — warm editorial band with a soft saffron glow */}
      <section className="relative border-b">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden opacity-70"
          style={{
            background:
              "radial-gradient(60% 70% at 50% 0%, rgba(232,160,32,0.16), transparent 70%)",
          }}
        />
        <div className="container relative py-14 sm:py-20">
          <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.18em] text-brand">
            ✦ Your community, your stays
          </p>
          <h1 className="text-center text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Book a{" "}
            <span className="font-bold text-[#C2410C]">homestay</span> in{" "}
            <span className="italic text-brand">your society</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-base text-muted-foreground sm:text-lg">
            Curated stays hosted by your neighbours — the easiest way to put up
            visiting family and guests, right inside the community you already
            call home.
          </p>
          <div className="mx-auto mt-7 max-w-3xl">
            <SearchBar variant="hero" />
          </div>
        </div>
      </section>

      <div className="container py-6">
        {featured.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-4 text-lg font-semibold">✨ Featured stays</h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {featured.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  platformFeePercent={settings.platformFeePercent}
                  rating={ratings.get(listing.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">Stays you&apos;ll love</h2>
          {listings.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              No published listings yet. Seed the database or approve a listing to
              see it here.
            </div>
          ) : rest.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every stay is featured above ✨
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rest.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  platformFeePercent={settings.platformFeePercent}
                  rating={ratings.get(listing.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </SearchDatesProvider>
  );
}
