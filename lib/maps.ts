export type LatLng = { lat: number; lng: number };

// Coordinates appear in a few shapes across Google Maps links: "/@lat,lng,17z"
// on a place URL, "?q=lat,lng" on a share URL, and "?ll=lat,lng" on older ones.
// Short maps.app.goo.gl links carry none of these — they only resolve after a
// redirect, which we deliberately don't follow from a server render.
const COORD_PATTERNS = [
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|ll|daddr|center)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
];

const inRange = ({ lat, lng }: LatLng) =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export function parseLatLng(url: string | null | undefined): LatLng | null {
  if (!url) return null;
  for (const re of COORD_PATTERNS) {
    const m = re.exec(url);
    if (!m) continue;
    const point = { lat: Number(m[1]), lng: Number(m[2]) };
    if (Number.isFinite(point.lat) && Number.isFinite(point.lng) && inRange(point)) {
      return point;
    }
  }
  return null;
}

/**
 * An admin types this link by hand, and it ends up in an href. Anything that
 * isn't plain http(s) — `javascript:` above all — must never reach the DOM.
 */
export function safeMapsHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Keyless Google Maps embed. `output=embed` needs no API key, so the preview
 * works without provisioning billing. Prefers coordinates pulled from the
 * admin's link, then the listing's own lat/lng, then the public address.
 */
export function mapEmbedSrc(opts: {
  mapsUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}): string | null {
  const fromUrl = parseLatLng(opts.mapsUrl);
  const point =
    fromUrl ??
    (typeof opts.lat === "number" && typeof opts.lng === "number"
      ? { lat: opts.lat, lng: opts.lng }
      : null);

  if (point && inRange(point)) {
    return `https://www.google.com/maps?q=${point.lat},${point.lng}&z=16&output=embed`;
  }
  const address = opts.address?.trim();
  if (address) {
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
  }
  return null;
}
