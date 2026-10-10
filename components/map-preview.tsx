import { MapPin } from "lucide-react";
import { mapEmbedSrc, safeMapsHref } from "@/lib/maps";

/**
 * Keyless Google Maps preview. The iframe is inert and an anchor sits on top of
 * it, so a tap anywhere on the map opens the admin's own link in Maps rather
 * than panning a tiny embedded viewport.
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
  const href = safeMapsHref(mapsUrl);
  if (!href) return null;

  const src = mapEmbedSrc({ mapsUrl, lat, lng, address });

  return (
    <div className="space-y-3">
      <div className="relative h-64 overflow-hidden rounded-xl border bg-muted sm:h-80">
        {src ? (
          <iframe
            src={src}
            title="Map preview"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="pointer-events-none h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <MapPin className="h-8 w-8" />
            <span className="text-sm">Open the exact location in Google Maps</span>
          </div>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open this location in Google Maps"
          className="absolute inset-0 transition hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {locality && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            {locality}
          </p>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-foreground underline underline-offset-4 transition hover:opacity-70"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}
