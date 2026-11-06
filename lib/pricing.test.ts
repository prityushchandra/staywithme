import { describe, it, expect } from "vitest";
import {
  computePricing,
  computeStayPricing,
  getMonthlyStayOffer,
  meetsMinimumStay,
  formatINR,
  getPriceInsight,
  nightlyPrice,
  strikePrice,
} from "./pricing";

const settings = {
  platformFeePercent: 10,
  suggestedPriceMin: 220000, // ₹2,200
  suggestedPriceMax: 250000, // ₹2,500
};

describe("computePricing", () => {
  it("adds a 10% platform fee to the base (spec example ₹1000 -> ₹1100)", () => {
    const r = computePricing(100000, settings); // ₹1000 in paise
    expect(r.base).toBe(100000);
    expect(r.platformFee).toBe(10000); // ₹100
    expect(r.total).toBe(110000); // ₹1100
    expect(r.platformFeePercent).toBe(10);
  });

  describe("minimum nights and fixed monthly stays discount", () => {
    const listing = {
      basePrice: 200000, discountedPrice: 150000, monthlyPrice: 3000000,
      minimumNights: 7, monthlyStayDiscount: 50000,
    };

    it("accepts the exact minimum and longer stays, but not shorter or incomplete ones", () => {
      expect(meetsMinimumStay(6, 7)).toBe(false);
      expect(meetsMinimumStay(7, 7)).toBe(true);
      expect(meetsMinimumStay(8, 7)).toBe(true);
      expect(meetsMinimumStay(1, null)).toBe(true);
      expect(meetsMinimumStay(0, 7)).toBe(false);
    });

    it("deducts a flat amount after the nightly sale price and platform fee", () => {
      expect(computeStayPricing(listing, 7, settings)).toMatchObject({
        base: 1050000, platformFee: 105000, totalBeforeDiscount: 1155000,
        monthlyStayDiscount: 50000, total: 1105000,
      });
    });

    it.each([
      [30, 3300000, 3250000],
      [31, 3410000, 3360000],
      [60, 6600000, 6550000],
    ])("deducts the offer only once for %i nights on the existing monthly rate", (nights, before, total) => {
      expect(computeStayPricing(listing, nights, settings)).toMatchObject({
        totalBeforeDiscount: before, monthlyStayDiscount: 50000, total,
      });
    });

    it("does not grant an offer below the threshold or without a configured minimum", () => {
      expect(computeStayPricing(listing, 6, settings).monthlyStayDiscount).toBe(0);
      expect(computeStayPricing({ ...listing, minimumNights: null }, 30, settings).monthlyStayDiscount).toBe(0);
      expect(computeStayPricing({ ...listing, monthlyStayDiscount: null }, 7, settings).total).toBe(1155000);
    });

    it("preserves fee rounding and rejects a discount that would make the stay free or negative", () => {
      const quote = computeStayPricing({
        basePrice: 109900, minimumNights: 2, monthlyStayDiscount: 9900,
      }, 2, settings);
      expect(quote.totalBeforeDiscount).toBe(241800);
      expect(quote.total).toBe(231900);
      expect(() => computeStayPricing({
        basePrice: 100000, minimumNights: 1, monthlyStayDiscount: 110000,
      }, 1, settings)).toThrow("lower than the booking total");
    });
  });

  it("rounds the platform fee to the nearest whole rupee", () => {
    // ₹1099 base, 10% = ₹109.90 -> rounds up to ₹110 so the total is a clean ₹1209
    const r = computePricing(109900, { platformFeePercent: 10 });
    expect(r.platformFee).toBe(11000); // ₹110
    expect(r.total).toBe(120900); // ₹1209
  });

  it("respects a configurable fee percent", () => {
    const r = computePricing(100000, { platformFeePercent: 20 });
    expect(r.platformFee).toBe(20000);
    expect(r.total).toBe(120000);
  });

  it("never produces negative values", () => {
    const r = computePricing(-500, { platformFeePercent: 10 });
    expect(r.base).toBe(0);
    expect(r.platformFee).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe("prorated monthly pricing and savings", () => {
  const listing = {
    basePrice: 200000, discountedPrice: 150000, monthlyPrice: 3000000, minimumNights: 30,
  };

  it.each([
    [30, 3000000, 3300000, 6600000],
    [44, 4400000, 4840000, 9680000],
    [60, 6000000, 6600000, 13200000],
  ])("prorates %i nights and compares against the base nightly price, not the sale price", (nights, base, total, regularTotal) => {
    expect(computeStayPricing(listing, nights, settings)).toMatchObject({
      base, total, regularTotal, monthly: true, savings: regularTotal - total,
      savingsPercent: 50, monthlyStayDiscount: 0,
    });
  });

  it("rounds only the complete prorated base, not the daily rate or each extra night", () => {
    expect(computeStayPricing({ ...listing, monthlyPrice: 3000100 }, 44, settings)).toMatchObject({
      base: 4400147, platformFee: 440000, total: 4840147,
    });
  });

  it("keeps nightly sale pricing below 30 nights when the listing permits shorter stays", () => {
    expect(computeStayPricing({ ...listing, minimumNights: null }, 29, settings)).toMatchObject({
      monthly: false, total: 4785000, regularTotal: 6380000, savingsPercent: 25,
    });
  });

  it("advertises the actual 30-night saving without requiring a separate minimum or fixed discount", () => {
    expect(getMonthlyStayOffer(listing, settings)).toEqual({
      total: 3300000, regularTotal: 6600000, savings: 3300000, savingsPercent: 50,
    });
    expect(getMonthlyStayOffer({ ...listing, monthlyPrice: null }, settings)).toBeNull();
  });

  it.each([6000000, 7000000])("does not invent savings when the monthly price %i is no cheaper", (monthlyPrice) => {
    expect(getMonthlyStayOffer({ ...listing, monthlyPrice }, settings)).toMatchObject({ savings: 0, savingsPercent: 0 });
    expect(computeStayPricing({ ...listing, monthlyPrice }, 44, settings)).toMatchObject({ savings: 0, savingsPercent: 0 });
  });

  it("does not round a positive monthly price into an advertised 100% discount", () => {
    expect(getMonthlyStayOffer({ ...listing, monthlyPrice: 100 }, settings)?.savingsPercent).toBe(99);
  });
});

describe("nightlyPrice / strikePrice", () => {
  it("charges the base price when there is no discount", () => {
    expect(nightlyPrice({ basePrice: 200000, discountedPrice: null })).toBe(200000);
    expect(nightlyPrice({ basePrice: 200000 })).toBe(200000);
    expect(strikePrice({ basePrice: 200000, discountedPrice: null })).toBeNull();
  });

  it("treats zero as 'no discount' rather than a free night", () => {
    expect(nightlyPrice({ basePrice: 200000, discountedPrice: 0 })).toBe(200000);
    expect(strikePrice({ basePrice: 200000, discountedPrice: 0 })).toBeNull();
  });

  it("charges the sale price and strikes the base when the discount is real", () => {
    const l = { basePrice: 200000, discountedPrice: 150000 };
    expect(nightlyPrice(l)).toBe(150000);
    expect(strikePrice(l)).toBe(200000);
  });

  it("does not strike a 'discount' that is not actually cheaper", () => {
    expect(strikePrice({ basePrice: 200000, discountedPrice: 200000 })).toBeNull();
    expect(strikePrice({ basePrice: 200000, discountedPrice: 250000 })).toBeNull();
  });
});

describe("formatINR", () => {
  it("formats whole rupees with the ₹ symbol and Indian grouping", () => {
    expect(formatINR(110000)).toBe("₹1,100");
    expect(formatINR(880000)).toBe("₹8,800");
    expect(formatINR(150000000)).toBe("₹15,00,000");
  });

  it("shows 2-decimal paise only when non-integer", () => {
    expect(formatINR(110050)).toBe("₹1,100.50");
  });
});

describe("getPriceInsight", () => {
  it("flags underpricing below the suggested min", () => {
    const i = getPriceInsight(200000, settings); // ₹2,000
    expect(i.status).toBe("below");
    expect(i.message).toContain("₹2,200");
  });

  it("marks competitive within the range (inclusive bounds)", () => {
    expect(getPriceInsight(220000, settings).status).toBe("competitive");
    expect(getPriceInsight(235000, settings).status).toBe("competitive");
    expect(getPriceInsight(250000, settings).status).toBe("competitive");
  });

  it("suggests lowering above the suggested max", () => {
    const i = getPriceInsight(300000, settings); // ₹3,000
    expect(i.status).toBe("above");
    expect(i.message).toContain("more inquiries");
  });
});
