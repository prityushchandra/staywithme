import { describe, it, expect } from "vitest";
import {
  computePricing,
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
