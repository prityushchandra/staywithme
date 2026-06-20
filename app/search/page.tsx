import { getPlatformSettings } from "@/lib/settings";
import { searchListings, getAmenityOptions, type SearchParams } from "@/lib/search";
import { getRatingSummaries } from "@/lib/reviews";
import { ListingCard } from "@/components/listing-card";
import { SearchFilters } from "@/components/search-filters";
import { MobileFilters } from "@/components/mobile-filters";
import { SearchDatesProvider } from "@/components/search-dates-context";

export const metadata = { title: "Search stays" };
export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function asNumber(v: string | string[] | undefined): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  return s && !Number.isNaN(n) ? n : undefined;
}
function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;

  const params: SearchParams = {
    destination: asString(sp.destination),
    checkIn: asString(sp.checkIn),
    checkOut: asString(sp.checkOut),
    guests: asNumber(sp.guests),
    minPrice: asNumber(sp.minPrice),
    maxPrice: asNumber(sp.maxPrice),
    roomType: asArray(sp.roomType),
    propertyType: asArray(sp.propertyType),
    bedrooms: asNumber(sp.bedrooms),
    bathrooms: asNumber(sp.bathrooms),
    amenities: asArray(sp.amenities),
  };

  const [settings, amenityOptions] = await Promise.all([
    getPlatformSettings(),
    getAmenityOptions(),
  ]);
  const results = await searchListings(params, settings.platformFeePercent);
  const ratings = await getRatingSummaries(results.map((l) => l.id));

  return (
    <SearchDatesProvider
      initial={{
        checkIn: asString(sp.checkIn),
        checkOut: asString(sp.checkOut),
        guests: asNumber(sp.guests),
      }}
    >
    <div className="container py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {params.destination ? `Stays in ${params.destination}` : "All stays"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? "place" : "places"}
          </p>
        </div>
        <MobileFilters amenities={amenityOptions} />
      </div>

      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 rounded-xl border p-5">
            <SearchFilters amenities={amenityOptions} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              No stays match your filters. Try widening your search.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((listing) => (
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
      </div>
    </div>
    </SearchDatesProvider>
  );
}
