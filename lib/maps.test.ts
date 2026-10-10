import { describe, it, expect } from "vitest";
import { mapEmbedSrc, parseLatLng, safeMapsHref } from "./maps";

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

  it("returns nothing when there's no location to show", () => {
    expect(mapEmbedSrc({ mapsUrl: "https://maps.app.goo.gl/abc" })).toBeNull();
  });
});
