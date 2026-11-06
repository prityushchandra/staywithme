import { describe, it, expect } from "vitest";
import { computeBookingMoney, computeBookingMoneyFromTotal, computeRefund } from "./payouts";

describe("computeBookingMoney (from the listing's base price)", () => {
  it("adds the platform fee on top of base × nights", () => {
    // ₹2,500/night × 3 = ₹7,500 base, +10% = ₹750 → ₹8,250 total
    const m = computeBookingMoney(250000, 3, 10);
    expect(m.baseTotal).toBe(750000);
    expect(m.platformFee).toBe(75000);
    expect(m.guestTotal).toBe(825000);
    expect(m.hostPayout).toBe(750000);
  });

  it("uses the discounted total for both the guest and the exact host/fee split", () => {
    const money = computeBookingMoney(200000, 30, 10, 3000000, {
      minimumNights: 30, monthlyStayDiscount: 50000,
    });
    expect(money.guestTotal).toBe(3250000);
    expect(money.baseTotal + money.platformFee).toBe(money.guestTotal);
    expect(money.hostPayout).toBe(money.baseTotal);
  });

  it("keeps a booked discount in refunds even after listing prices change", () => {
    const refund = computeRefund(
      "FLEXIBLE", 900000, 30, 10, 3250000,
      new Date("2027-03-01"), new Date("2027-02-01"), 9000000, 3250000
    );
    const money = computeBookingMoneyFromTotal(3250000, 30, 10);
    expect(refund.guestRefund).toBe(money.baseTotal);
    expect(refund.platformFee).toBe(money.platformFee);
  });
});

describe("computeBookingMoneyFromTotal (negotiated, fee-inclusive total)", () => {
  it("splits ₹7,920 (₹2,400/night × 3 + 10%) back into ₹7,200 host + ₹720 fee", () => {
    const m = computeBookingMoneyFromTotal(792000, 3, 10);
    expect(m.baseTotal).toBe(720000); // ₹7,200 host payout
    expect(m.platformFee).toBe(72000); // ₹720 admin earning
    expect(m.guestTotal).toBe(792000);
    expect(m.hostPayout).toBe(720000);
    expect(m.baseTotal + m.platformFee).toBe(792000); // exact split
  });

  it("rounds to whole rupees and still keeps base + fee === total", () => {
    const m = computeBookingMoneyFromTotal(700000, 3, 10); // ₹7,000
    expect(m.baseTotal % 100).toBe(0); // whole rupees (paise multiple of 100)
    expect(m.platformFee % 100).toBe(0);
    expect(m.baseTotal + m.platformFee).toBe(700000);
  });

  it("never lets the base exceed the total", () => {
    const m = computeBookingMoneyFromTotal(1000, 1, 10);
    expect(m.baseTotal).toBeLessThanOrEqual(1000);
    expect(m.platformFee).toBeGreaterThanOrEqual(0);
  });

  it("clamps a negative total to zero", () => {
    const m = computeBookingMoneyFromTotal(-500, 2, 10);
    expect(m.guestTotal).toBe(0);
    expect(m.baseTotal).toBe(0);
    expect(m.platformFee).toBe(0);
  });
});
