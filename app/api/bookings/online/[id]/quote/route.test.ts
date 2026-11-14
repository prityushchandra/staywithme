import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), quote: vi.fn(), booking: { findUnique: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { booking: mocks.booking } }));
vi.mock("@/lib/online-bookings", () => ({ quoteStay: mocks.quote }));

const booking = {
  guestId: "guest", source: "ONLINE", status: "PENDING", listingId: "listing",
  checkIn: new Date("2027-03-01"), checkOut: new Date("2027-03-03"),
  razorpayOrderId: null, couponReservation: null,
};
const params = { params: Promise.resolve({ id: "booking" }) };
const request = (couponCode: string | null) => new Request("http://localhost/api/bookings/online/booking/quote", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ couponCode }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "guest" } });
  mocks.booking.findUnique.mockResolvedValue(booking);
  mocks.quote.mockResolvedValue({ ok: true, available: true, pricing: { total: 176000 } });
});

describe("guest coupon quotes", () => {
  it("requires sign-in and the guest's own unpaid online booking", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(request("ONE-STAY"), params)).status).toBe(401);
    for (const changes of [{ guestId: "other" }, { source: "MANUAL" }, { status: "AWAITING_APPROVAL" }]) {
      mocks.booking.findUnique.mockResolvedValue({ ...booking, ...changes });
      expect((await POST(request("ONE-STAY"), params)).status).toBe(404);
    }
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("normalizes the code, returns a fresh quote and allows removal before Pay now", async () => {
    const response = await POST(request(" one-stay "), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ pricing: { total: 176000 }, pricingLocked: false });
    expect(mocks.quote).toHaveBeenLastCalledWith("listing", booking.checkIn, booking.checkOut, {
      couponCode: "ONE-STAY", reservation: null,
    });
    expect((await POST(request(null), params)).status).toBe(200);
    expect(mocks.quote).toHaveBeenLastCalledWith("listing", booking.checkIn, booking.checkOut, {
      couponCode: null, reservation: null,
    });
  });

  it("returns the locked snapshot when another tab tries to remove an already reserved coupon", async () => {
    mocks.booking.findUnique.mockResolvedValue({ ...booking, couponReservation: {
      code: "ONE-STAY", kind: "DAILY", amount: 80000, baseAmount: 160000, platformFee: 16000,
      platformFeePercent: 10, regularBase: 200000, regularTotal: 220000,
    } });
    const response = await POST(request(null), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ pricingLocked: true, pricing: {
      total: 176000, savings: 44000, coupon: { code: "ONE-STAY" },
    } });
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("rejects unavailable dates and cannot add a coupon to a non-coupon payment attempt", async () => {
    mocks.quote.mockResolvedValue({ ok: true, available: false });
    expect((await POST(request("ONE-STAY"), params)).status).toBe(409);
    mocks.booking.findUnique.mockResolvedValue({ ...booking, razorpayOrderId: "order-started" });
    expect((await POST(request("ONE-STAY"), params)).status).toBe(409);
    expect(mocks.quote).toHaveBeenCalledOnce();
  });
});
