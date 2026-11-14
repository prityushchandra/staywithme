import { beforeEach, describe, expect, it, vi } from "vitest";
import { availableCoupon, reserveBookingCoupon, reservedCouponPricing } from "./coupons";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  listingCoupon: { findUnique: vi.fn() },
  booking: { findUnique: vi.fn(), update: vi.fn() },
  platformSettings: { findUnique: vi.fn() },
  couponReservation: { create: vi.fn() },
}));
vi.mock("./db", () => ({ prisma: db }));

const coupon = { id: "coupon", listingId: "listing", code: "ONE-STAY", kind: "DAILY", amount: 120000, active: true, reservation: null };
const booking = {
  id: "booking", guestId: "guest", source: "ONLINE", status: "PENDING", guests: 1, listingId: "listing",
  razorpayOrderId: null, couponReservation: null,
  checkIn: new Date("2027-03-01"), checkOut: new Date("2027-03-03"),
  listing: { status: "PUBLISHED", basePrice: 200000, discountedPrice: 150000, minimumNights: 2, monthlyStayDiscount: 50000 },
};
const input = { bookingId: "booking", guestId: "guest", guests: 1, code: coupon.code, expectedTotal: 264000 };
const reservation = {
  couponId: "coupon", bookingId: "booking", code: coupon.code, kind: "DAILY" as const, amount: 120000,
  baseAmount: 240000, platformFee: 24000, platformFeePercent: 10, regularBase: 400000, regularTotal: 440000,
  createdAt: new Date("2027-01-01"),
};

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (run) => run(db));
  db.$queryRaw.mockResolvedValue([{ id: "example" }]);
  db.listingCoupon.findUnique.mockResolvedValue(coupon);
  db.booking.findUnique.mockResolvedValue(booking);
  db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 10 });
  db.couponReservation.create.mockResolvedValue(reservation);
});

describe("coupon eligibility", () => {
  it("normalizes the code for the intended listing without reserving it on preview", async () => {
    expect(await availableCoupon("listing", "  one-stay ", 2)).toMatchObject({ ok: true, coupon });
    expect(db.listingCoupon.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "ONE-STAY" } }));
    expect(db.couponReservation.create).not.toHaveBeenCalled();
  });

  it.each([
    null, { ...coupon, listingId: "other-listing" }, { ...coupon, active: false },
    { ...coupon, reservation: { couponId: "coupon" } },
  ])("rejects unavailable, wrong-listing, paused or already reserved codes", async (stored) => {
    db.listingCoupon.findUnique.mockResolvedValue(stored);
    expect((await availableCoupon("listing", coupon.code, 2)).ok).toBe(false);
  });

  it("requires 30 nights for a monthly coupon", async () => {
    db.listingCoupon.findUnique.mockResolvedValue({ ...coupon, kind: "MONTHLY", amount: 3000000 });
    expect(await availableCoupon("listing", coupon.code, 29)).toMatchObject({ ok: false, error: expect.stringContaining("30 nights") });
  });
});

describe("single-booking reservation", () => {
  it("locks the booking and coupon, then saves the coupon and booking price in the same transaction", async () => {
    expect(await reserveBookingCoupon(input)).toMatchObject({ ok: true, pricing: { total: 264000, monthlyStayDiscount: 0 } });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.couponReservation.create).toHaveBeenCalledWith({ data: {
      couponId: "coupon", bookingId: "booking", code: "ONE-STAY", kind: "DAILY", amount: 120000,
      baseAmount: 240000, platformFee: 24000, platformFeePercent: 10, regularBase: 400000, regularTotal: 440000,
    } });
    expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking" }, data: { totalAmount: 264000 } });
  });

  it("rejects the competing booking after the coupon was claimed", async () => {
    db.listingCoupon.findUnique.mockResolvedValue({ ...coupon, reservation: { couponId: "coupon" } });
    expect((await reserveBookingCoupon(input)).ok).toBe(false);
    expect(db.couponReservation.create).not.toHaveBeenCalled();
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("keeps the original snapshot on the same booking's retry without consulting edited or paused coupon settings", async () => {
    db.booking.findUnique.mockResolvedValue({ ...booking, couponReservation: reservation, listing: { ...booking.listing, basePrice: 300000 } });
    expect(await reserveBookingCoupon(input)).toEqual({ ok: true, pricing: reservedCouponPricing(reservation) });
    expect(db.listingCoupon.findUnique).not.toHaveBeenCalled();
    expect(db.platformSettings.findUnique).not.toHaveBeenCalled();
    expect(db.couponReservation.create).not.toHaveBeenCalled();
  });

  it("does not replace a locked coupon or accept a stale total", async () => {
    db.booking.findUnique.mockResolvedValue({ ...booking, couponReservation: reservation });
    expect((await reserveBookingCoupon({ ...input, code: "DIFFERENT" })).ok).toBe(false);
    expect((await reserveBookingCoupon({ ...input, expectedTotal: 1 })).ok).toBe(false);
    expect(db.couponReservation.create).not.toHaveBeenCalled();
  });

  it("rechecks a changed price before consuming the coupon", async () => {
    db.listingCoupon.findUnique.mockResolvedValue({ ...coupon, amount: 100000 });
    expect(await reserveBookingCoupon(input)).toMatchObject({ ok: false, pricing: { total: 220000 }, pricingLocked: false });
    expect(db.couponReservation.create).not.toHaveBeenCalled();
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("keeps the listing minimum and refuses changes after an existing non-coupon checkout", async () => {
    db.booking.findUnique.mockResolvedValue({ ...booking, listing: { ...booking.listing, minimumNights: 3 } });
    expect(await reserveBookingCoupon(input)).toMatchObject({ ok: false, error: expect.stringContaining("Minimum 3 nights") });
    db.booking.findUnique.mockResolvedValue({ ...booking, razorpayOrderId: "existing-order" });
    expect((await reserveBookingCoupon(input)).ok).toBe(false);
    expect(db.couponReservation.create).not.toHaveBeenCalled();
  });
});
