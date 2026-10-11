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

// Where a place *name* hides in the various link shapes Google hands out.
const QUERY_PARAMS = ["q", "query", "destination", "daddr"];
const COORD_PAIR = /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/;

/**
 * The human destination carried by a Maps link — "Brigade Cornerstone Utopia,
 * Bengaluru" and such. Coordinate pairs are skipped because `parseLatLng`
 * already handles those far more precisely.
 */
export function mapsQuery(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  for (const key of QUERY_PARAMS) {
    const raw = parsed.searchParams.get(key)?.trim();
    if (raw && !COORD_PAIR.test(raw)) return raw;
  }
  // "/maps/place/Brigade+Cornerstone+Utopia/@12.9,77.7,17z" -> the place name.
  const place = /\/maps\/place\/([^/@]+)/.exec(parsed.pathname);
  if (place) {
    const name = decodeURIComponent(place[1]).replace(/\+/g, " ").trim();
    if (name) return name;
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
  // A place name out of the admin's own link beats the listing's public
  // address, which is deliberately vague ("Bengaluru, India").
  const query = mapsQuery(opts.mapsUrl) ?? opts.address?.trim();
  if (query) {
    return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
  }
  return null;
}

/**
 * The URL to send a guest to when they tap the map.
 *
 * Google's share sheet hands out links loaded with single-session parameters
 * (`entry=gps`, `lucs`, `g_ep`, `skid`). Those describe a handoff from the one
 * device that created them, and the Maps app rejects the whole URL with
 * "unsupported link" when it sees them anywhere else. So a pasted link is
 * never given to the OS as-is: we read the destination out of it and rebuild
 * the single documented form — `/maps/search/?api=1&query=` — that Android,
 * iOS and the web all honour.
 */
export function mapsViewHref(opts: {
  mapsUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}): string | null {
  const href = safeMapsHref(opts.mapsUrl);
  if (!href) return null;

  const point =
    parseLatLng(href) ??
    (typeof opts.lat === "number" && typeof opts.lng === "number"
      ? { lat: opts.lat, lng: opts.lng }
      : null);
  if (point && inRange(point)) {
    return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
  }

  const query = mapsQuery(href) ?? opts.address?.trim();
  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  // Nothing readable in the link — an un-expanded short link, say. The
  // original still resolves in a browser, so it beats dropping the link.
  return href;
}

const SHORT_MAPS_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

/**
 * Short links (`maps.app.goo.gl/...`) carry no destination at all — they only
 * reveal one after a redirect. Expanding at save time means the listing page
 * never pays for a round trip, and gives `mapsQuery` something to work with.
 * Server-only: the redirect is opaque to a browser's fetch.
 */
export async function expandMapsShortLink(
  url: string | null | undefined
): Promise<string | null> {
  const href = safeMapsHref(url);
  if (!href) return null;

  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return href;
  }
  if (!SHORT_MAPS_HOSTS.has(host)) return href;

  try {
    const res = await fetch(href, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const location = res.headers.get("location");
    // Keep what the admin typed if Google answers with anything unexpected.
    return (location && safeMapsHref(location)) || href;
  } catch {
    return href;
  }
}
