import { describe, it, expect } from "vitest";
import {
  isHttpUrl,
  isAirbnbUrl,
  isDuplicateRefCodeError,
  listingInputSchema,
  listingFaqsSchema,
  listingFaqDraftsSchema,
  MAPS_URL_MAX,
} from "./validation";

const baseListing = {
  title: "Rest, Relax, Refresh",
  description: "A bright two-bedroom flat a short walk from the lake and the market.",
  propertyType: "APARTMENT",
  roomType: "ENTIRE",
  addressLine: "StayWithMe Society",
  city: "Bengaluru",
  country: "India",
  flatNumber: "L1234",
  block: "Tower A",
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  maxGuests: 2,
  basePriceRupees: 2400,
  cancellationPolicy: "FLEXIBLE",
  imageUrls: ["https://example.com/a.jpg"],
};

describe("listing minimum stay input", () => {
  const parse = (extra: Record<string, unknown>) => listingInputSchema.safeParse({ ...baseListing, ...extra });

  it("keeps existing listings unrestricted and accepts an optional minimum without an offer", () => {
    expect(listingInputSchema.parse(baseListing)).toMatchObject({ minimumNights: 0, monthlyStayDiscountRupees: 0 });
    expect(parse({ minimumNights: 30 }).success).toBe(true);
    expect(parse({ minimumNights: 30, monthlyStayDiscountRupees: 5000 }).success).toBe(true);
  });

  it.each([-1, 1.5, 366, "abc"])("rejects invalid minimum nights %s", (minimumNights) => {
    expect(parse({ minimumNights }).success).toBe(false);
  });

  it("requires a minimum for a fixed offer and rejects negative or fractional discounts", () => {
    expect(parse({ monthlyStayDiscountRupees: 500 }).success).toBe(false);
    expect(parse({ minimumNights: 2, monthlyStayDiscountRupees: -1 }).success).toBe(false);
    expect(parse({ minimumNights: 2, monthlyStayDiscountRupees: 50.5 }).success).toBe(false);
  });

  it("validates against the sale rate and the later monthly tier, not just the headline price", () => {
    expect(parse({ minimumNights: 2, discountedPriceRupees: 1000, monthlyStayDiscountRupees: 2000 }).success).toBe(false);
    expect(parse({ minimumNights: 7, monthlyPriceRupees: 5000, monthlyStayDiscountRupees: 5000 }).success).toBe(false);
    expect(parse({ minimumNights: 60, monthlyPriceRupees: 5000, monthlyStayDiscountRupees: 9999 }).success).toBe(true);
    expect(parse({ minimumNights: 60, monthlyPriceRupees: 5000, monthlyStayDiscountRupees: 10000 }).success).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) links with a real host", () => {
    expect(isHttpUrl("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isHttpUrl("http://maps.google.com/?q=12.9,77.6")).toBe(true);
  });

  describe("listing FAQs", () => {
    it("trims published questions and answers while preserving order and paragraphs", () => {
      expect(listingFaqsSchema.parse([
        { question: "  Can I arrive early?  ", answer: "  Please ask first.\nAvailability varies.  " },
        { question: "Is parking available?", answer: "Ask about spaces before arrival." },
      ])).toEqual([
        { question: "Can I arrive early?", answer: "Please ask first.\nAvailability varies." },
        { question: "Is parking available?", answer: "Ask about spaces before arrival." },
      ]);
    });

    it("distinguishes omitted FAQs from an explicit request to clear them", () => {
      expect(listingInputSchema.parse(baseListing).faqs).toBeUndefined();
      expect(listingInputSchema.parse({ ...baseListing, faqs: [] }).faqs).toEqual([]);
    });

    it.each([
      [{ question: " ", answer: "An answer" }],
      [{ question: "A question?", answer: "\n " }],
      [{ question: "Missing answer?" }],
      [{ question: "Q".repeat(201), answer: "An answer" }],
      [{ question: "A question?", answer: "A".repeat(2001) }],
      Array.from({ length: 21 }, () => ({ question: "A question?", answer: "An answer" })),
      "not an array",
    ].map((faqs) => ({ faqs })))("rejects incomplete or oversized FAQ input (%#)", ({ faqs }) => {
      expect(listingFaqsSchema.safeParse(faqs).success).toBe(false);
    });

    it("restores unfinished drafts without accepting them for publication", () => {
      const draft = [{ question: "Is parking available?", answer: "" }];
      expect(listingFaqDraftsSchema.parse(draft)).toEqual(draft);
      expect(listingFaqsSchema.safeParse(draft).success).toBe(false);
      expect(listingFaqDraftsSchema.safeParse([{ question: 5, answer: "" }]).success).toBe(false);
    });
  });

  it("rejects other schemes, bare hosts and junk", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isHttpUrl("https://localhost")).toBe(false);
    expect(isHttpUrl("maps.google.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("isAirbnbUrl", () => {
  it("accepts Airbnb's own hosts and share links", () => {
    expect(isAirbnbUrl("https://www.airbnb.co.in/rooms/12345678")).toBe(true);
    expect(isAirbnbUrl("https://airbnb.com/rooms/9?source_impression_id=x")).toBe(true);
    expect(isAirbnbUrl("https://fr.airbnb.com/rooms/9")).toBe(true);
    expect(isAirbnbUrl("https://abnb.me/abcdef")).toBe(true);
  });

  it("rejects lookalike hosts that would become an open redirect", () => {
    expect(isAirbnbUrl("https://airbnb.evil.com/rooms/1")).toBe(false);
    expect(isAirbnbUrl("https://notairbnb.com/rooms/1")).toBe(false);
    expect(isAirbnbUrl("https://airbnb.com.attacker.net/x")).toBe(false);
    expect(isAirbnbUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isDuplicateRefCodeError", () => {
  it("matches a P2002 on refCode, and a P2002 with no reported target", () => {
    expect(
      isDuplicateRefCodeError({ code: "P2002", meta: { target: ["refCode"] } })
    ).toBe(true);
    expect(
      isDuplicateRefCodeError({ code: "P2002", meta: { target: "Listing_refCode_key" } })
    ).toBe(true);
    expect(isDuplicateRefCodeError({ code: "P2002" })).toBe(true);
  });

  it("ignores other constraints and other errors", () => {
    expect(
      isDuplicateRefCodeError({ code: "P2002", meta: { target: ["listingId", "amenityId"] } })
    ).toBe(false);
    expect(isDuplicateRefCodeError({ code: "P2025" })).toBe(false);
    expect(isDuplicateRefCodeError(new Error("boom"))).toBe(false);
    expect(isDuplicateRefCodeError(null)).toBe(false);
  });
});

describe("listingInputSchema — property id, maps link, guest favorite", () => {
  const parse = (extra: Record<string, unknown>) =>
    listingInputSchema.safeParse({ ...baseListing, ...extra });

  it("uppercases and trims the Property ID", () => {
    const r = parse({ refCode: "  haxgt " });
    expect(r.success && r.data.refCode).toBe("HAXGT");
  });

  it("treats a blank Property ID / maps link as empty, not invalid", () => {
    const r = parse({ refCode: "   ", mapsUrl: "  " });
    expect(r.success && r.data.refCode).toBe("");
    expect(r.success && r.data.mapsUrl).toBe("");
  });

  it("rejects a malformed Property ID", () => {
    expect(parse({ refCode: "AB" }).success).toBe(false);
    expect(parse({ refCode: "HAX-GT" }).success).toBe(false);
    expect(parse({ refCode: "ABCDEFGHIJKLM" }).success).toBe(false);
  });

  it("rejects a maps link that isn't an http(s) URL", () => {
    expect(parse({ mapsUrl: "not a url" }).success).toBe(false);
    expect(parse({ mapsUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(parse({ mapsUrl: "https://maps.app.goo.gl/abc" }).success).toBe(true);
  });

  it("accepts an expanded share link, which carries Google's tracking blobs", () => {
    // A real maps.app.goo.gl link resolves to a canonical URL well past 600
    // characters. Capping below that made such a listing impossible to re-save.
    const expanded = `https://maps.google.com/?q=Brigade+Cornerstone+Utopia,+Bengaluru&ftid=0x3bae13006a42a45f&lucs=${"9".repeat(500)}&g_st=ic`;
    expect(expanded.length).toBeGreaterThan(500);
    expect(parse({ mapsUrl: expanded }).success).toBe(true);
  });

  it("still rejects a maps link beyond the stored ceiling", () => {
    const r = parse({ mapsUrl: `https://maps.google.com/?q=${"a".repeat(MAPS_URL_MAX)}` });
    expect(r.success).toBe(false);
  });

  it("defaults guestFavorite to false when the client omits it", () => {
    const r = parse({});
    expect(r.success && r.data.guestFavorite).toBe(false);
  });
});
