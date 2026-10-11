import { ArrowUpRight, MapPin } from "lucide-react";
import { mapEmbedSrc, mapsViewHref } from "@/lib/maps";

/**
 * Keyless Google Maps preview. The iframe is inert and an anchor sits on top of
 * it, so a tap anywhere on the map opens the admin's own link in Maps rather
 * than panning a tiny embedded viewport.
 *
 * Everything the guest reads floats over the map — a locality chip and an
 * "Open in Maps" pill — so the card stays a single clean tile instead of a
 * framed image with a caption bolted underneath.
 */
export function MapPreview({
  mapsUrl,
  lat,
  lng,
  address,
  locality,
}: {
  mapsUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  locality?: string | null;
}) {
  const href = mapsViewHref({ mapsUrl, lat, lng, address });
  if (!href) return null;

  const src = mapEmbedSrc({ mapsUrl, lat, lng, address });

  return (
    <div className="group relative h-72 overflow-hidden rounded-2xl bg-muted shadow-sm ring-1 ring-black/[0.08] transition-shadow duration-300 ease-ios [@media(hover:hover)]:hover:shadow-lg sm:h-[22rem]">
      {src ? (
        <iframe
          src={src}
          title="Map preview"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          // Inert, so the anchor above it receives every tap. The slow push-in
          // on hover is the only hint that the tile is a link to somewhere.
          className="pointer-events-none h-full w-full border-0 transition-transform duration-500 ease-ios motion-reduce:transition-none [@media(hover:hover)]:group-hover:scale-[1.04]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-muted to-muted/60 text-muted-foreground">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm">
            <MapPin className="h-6 w-6 text-brand" />
          </span>
          <span className="text-sm font-medium">
            Open the exact location in Google Maps
          </span>
        </div>
      )}

      {/* Chips sit above the map but out of the way of pointer events, so the
          whole tile stays one big target for the anchor below them. */}
      {locality && (
        <span className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur-sm sm:left-4 sm:top-4 sm:text-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" />
          <span className="truncate">{locality}</span>
        </span>
      )}

      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-lg transition-transform duration-300 ease-ios motion-reduce:transition-none [@media(hover:hover)]:group-hover:-translate-y-0.5 sm:bottom-4 sm:right-4 sm:text-sm"
      >
        Open in Maps
        <ArrowUpRight className="h-4 w-4" />
      </span>

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open this location in Google Maps"
        className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </div>
  );
}
