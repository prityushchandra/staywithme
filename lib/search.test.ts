import { describe, it, expect } from "vitest";
import { buildListingWhere } from "./search";

describe("buildListingWhere", () => {
  it("always forces PUBLISHED status (approval gate)", () => {
    const w = buildListingWhere({}, 10);
    expect(w.status).toBe("PUBLISHED");
  });

  it("searches destination across city/country/title, case-insensitive", () => {
    const w = buildListingWhere({ destination: "goa" }, 10);
    expect(w.OR).toEqual([
      { city: { contains: "goa", mode: "insensitive" } },
      { country: { contains: "goa", mode: "insensitive" } },
      { title: { contains: "goa", mode: "insensitive" } },
    ]);
  });

  it("filters guests as a minimum on maxGuests", () => {
    const w = buildListingWhere({ guests: 4 }, 10);
    expect(w.maxGuests).toEqual({ gte: 4 });
  });

  it("converts total-price (rupees) bounds to base-price paise via the fee", () => {
    // total ₹1100 at 10% fee -> base ₹1000 = 100000 paise
    const w = buildListingWhere({ minPrice: 1100, maxPrice: 2200 }, 10);
    expect((w.basePrice as { gte: number }).gte).toBe(100000);
    expect((w.basePrice as { lte: number }).lte).toBe(200000);
  });

  it("whitelists room/property type enums", () => {
    const w = buildListingWhere(
      { roomType: ["ENTIRE", "HACK"], propertyType: ["VILLA"] },
      10
    );
    expect(w.roomType).toEqual({ in: ["ENTIRE"] });
    expect(w.propertyType).toEqual({ in: ["VILLA"] });
  });

  it("requires ALL amenities (AND of some-clauses)", () => {
    const w = buildListingWhere({ amenities: ["wifi", "pool"] }, 10);
    expect(w.AND).toEqual([
      { amenities: { some: { amenity: { key: "wifi" } } } },
      { amenities: { some: { amenity: { key: "pool" } } } },
    ]);
  });

  it("treats bedrooms/bathrooms as minimums", () => {
    const w = buildListingWhere({ bedrooms: 2, bathrooms: 1 }, 10);
    expect(w.bedrooms).toEqual({ gte: 2 });
    expect(w.bathrooms).toEqual({ gte: 1 });
  });

  it("excludes listings blocked over the requested stay dates", () => {
    const w = buildListingWhere(
      { checkIn: "2026-07-10", checkOut: "2026-07-14" },
      10
    );
    const clause = (w.AND as Array<Record<string, unknown>>)[0] as {
      availability: { none: { startDate: { lt: Date }; endDate: { gt: Date } } };
    };
    expect(clause.availability.none.startDate.lt).toEqual(new Date("2026-07-14T00:00:00.000Z"));
    expect(clause.availability.none.endDate.gt).toEqual(new Date("2026-07-10T00:00:00.000Z"));
  });

  it("ignores availability when only one date is given", () => {
    const w = buildListingWhere({ checkIn: "2026-07-10" }, 10);
    expect(w.AND).toBeUndefined();
  });
});
