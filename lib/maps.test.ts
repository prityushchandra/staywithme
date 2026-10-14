import { describe, it, expect } from "vitest";
import { expandMapsShortLink, mapEmbedSrc, mapsQuery, mapsViewHref, parseLatLng, safeMapsHref } from "./maps";
import { MAPS_URL_MAX } from "./validation";

// The real URL a maps.app.goo.gl share link redirects to: a place name, no
// coordinates, and a pile of single-session parameters.
const SHARED_LINK =
  "https://maps.google.com/?q=Paradise+Block,+Brigade+Cornerstone+Utopia,+Bengaluru,+Karnataka+560087" +
  "&ftid=0x3bae13006a42a45f:0x9029eac73f56959c&entry=gps&shh=CAE&lucs=,94297699&g_ep=CAISEjI2&g_st=ic";

describe("parseLatLng", () => {
  it("reads coordinates out of the shapes Google actually emits", () => {
    expect(parseLatLng("https://www.google.com/maps/@19.0760,72.8777,15z")).toEqual({
      lat: 19.076,
      lng: 72.8777,
    });
    expect(parseLatLng("https://www.google.com/maps?q=19.0760,72.8777")).toEqual({
      lat: 19.076,
      lng: 72.8777,
    });
    expect(
      parseLatLng("https://maps.google.com/maps/place/Home/data=!3d19.076!4d72.8777"),
    ).toEqual({ lat: 19.076, lng: 72.8777 });
  });

  it("gives up on short links, which only resolve after a redirect", () => {
    expect(parseLatLng("https://maps.app.goo.gl/abc123")).toBeNull();
  });

  it("rejects numbers that aren't a point on earth", () => {
    expect(parseLatLng("https://www.google.com/maps/@99.5,200.1,15z")).toBeNull();
  });

  it("handles nothing at all", () => {
    expect(parseLatLng(null)).toBeNull();
    expect(parseLatLng("")).toBeNull();
  });
});

describe("safeMapsHref", () => {
  it("passes ordinary links through", () => {
    expect(safeMapsHref(" https://maps.app.goo.gl/abc ")).toBe("https://maps.app.goo.gl/abc");
  });

  it("refuses anything that isn't http(s)", () => {
    expect(safeMapsHref("javascript:alert(1)")).toBeNull();
    expect(safeMapsHref("data:text/html,<script>")).toBeNull();
    expect(safeMapsHref("not a url")).toBeNull();
    expect(safeMapsHref(null)).toBeNull();
  });
});

describe("mapEmbedSrc", () => {
  it("prefers coordinates from the admin's link", () => {
    expect(
      mapEmbedSrc({
        mapsUrl: "https://www.google.com/maps/@19.076,72.8777,15z",
        lat: 1,
        lng: 2,
        address: "Somewhere",
      }),
    ).toBe("https://www.google.com/maps?q=19.076,72.8777&z=16&output=embed");
  });

  it("falls back to the listing's own coordinates, then its address", () => {
    expect(
      mapEmbedSrc({ mapsUrl: "https://maps.app.goo.gl/abc", lat: 19.076, lng: 72.8777 }),
    ).toBe("https://www.google.com/maps?q=19.076,72.8777&z=16&output=embed");

    expect(
      mapEmbedSrc({ mapsUrl: "https://maps.app.goo.gl/abc", address: "Prestige Park, Bengaluru" }),
    ).toBe("https://www.google.com/maps?q=Prestige%20Park%2C%20Bengaluru&z=15&output=embed");
  });

  it("prefers a place name from the link over the listing's vaguer address", () => {
    expect(mapEmbedSrc({ mapsUrl: SHARED_LINK, address: "Bengaluru, India" })).toBe(
      "https://www.google.com/maps?q=Paradise%20Block%2C%20Brigade%20Cornerstone%20Utopia%2C%20Bengaluru%2C%20Karnataka%20560087&z=15&output=embed",
    );
  });

  it("returns nothing when there's no location to show", () => {
    expect(mapEmbedSrc({ mapsUrl: "https://maps.app.goo.gl/abc" })).toBeNull();
  });
});

describe("mapsQuery", () => {
  it("reads the place name out of a shared link", () => {
    expect(mapsQuery(SHARED_LINK)).toBe(
      "Paradise Block, Brigade Cornerstone Utopia, Bengaluru, Karnataka 560087",
    );
  });

  it("reads it out of a /maps/place/ path", () => {
    expect(
      mapsQuery("https://www.google.com/maps/place/Brigade+Utopia/@12.9,77.7,17z"),
    ).toBe("Brigade Utopia");
  });

  it("ignores coordinate pairs, which parseLatLng handles better", () => {
    expect(mapsQuery("https://www.google.com/maps?q=19.076,72.8777")).toBeNull();
  });

  it("handles links with no destination in them", () => {
    expect(mapsQuery("https://maps.app.goo.gl/abc")).toBeNull();
    expect(mapsQuery("not a url")).toBeNull();
    expect(mapsQuery(null)).toBeNull();
  });
});

describe("mapsViewHref", () => {
  // Maps rejects the session parameters in a raw share link with "unsupported
  // link", so the destination is rebuilt in the documented portable form.
  it("rebuilds a shared link as a portable Maps URL", () => {
    expect(mapsViewHref({ mapsUrl: SHARED_LINK, address: "Bengaluru, India" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Paradise%20Block%2C%20Brigade%20Cornerstone%20Utopia%2C%20Bengaluru%2C%20Karnataka%20560087",
    );
  });

  it("prefers coordinates when the link carries them", () => {
    expect(
      mapsViewHref({
        mapsUrl: "https://www.google.com/maps/@19.076,72.8777,15z",
        address: "Somewhere",
      }),
    ).toBe("https://www.google.com/maps/search/?api=1&query=19.076,72.8777");
  });

  it("falls back to the listing's coordinates, then its address", () => {
    expect(
      mapsViewHref({ mapsUrl: "https://maps.app.goo.gl/abc", lat: 19.076, lng: 72.8777 }),
    ).toBe("https://www.google.com/maps/search/?api=1&query=19.076,72.8777");

    expect(
      mapsViewHref({ mapsUrl: "https://maps.app.goo.gl/abc", address: "Bengaluru, India" }),
    ).toBe("https://www.google.com/maps/search/?api=1&query=Bengaluru%2C%20India");
  });

  it("keeps an unreadable link rather than dropping it", () => {
    expect(mapsViewHref({ mapsUrl: "https://maps.app.goo.gl/abc" })).toBe(
      "https://maps.app.goo.gl/abc",
    );
  });

  it("still refuses anything that isn't http(s)", () => {
    expect(mapsViewHref({ mapsUrl: "javascript:alert(1)", address: "Bengaluru" })).toBeNull();
    expect(mapsViewHref({ mapsUrl: null, lat: 19.076, lng: 72.8777 })).toBeNull();
  });
});

describe("expandMapsShortLink", () => {
  const SHORT = "https://maps.app.goo.gl/abc";
  const stubRedirect = (location: string) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { location } })) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };

  it("stores the expanded destination so the listing page skips the round trip", async () => {
    const restore = stubRedirect(SHARED_LINK);
    try {
      expect(await expandMapsShortLink(SHORT)).toBe(SHARED_LINK);
    } finally {
      restore();
    }
  });

  it("keeps the short link when the expansion is too long to store", async () => {
    // Storing an over-length URL used to make the listing fail validation on
    // every later edit; the short link resolves in a browser just as well.
    const restore = stubRedirect(`https://maps.google.com/?q=${"a".repeat(MAPS_URL_MAX)}`);
    try {
      expect(await expandMapsShortLink(SHORT)).toBe(SHORT);
    } finally {
      restore();
    }
  });

  it("leaves an already-expanded link alone", async () => {
    expect(await expandMapsShortLink(SHARED_LINK)).toBe(SHARED_LINK);
    expect(await expandMapsShortLink("javascript:alert(1)")).toBeNull();
  });
});
