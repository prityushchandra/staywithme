import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), booking: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { booking: { findUnique: mocks.booking } } }));
vi.mock("@/lib/razorpay", () => ({ verifyRazorpayWebhookSignature: mocks.verify }));
vi.mock("@/lib/online-bookings", () => ({ reconcileBookingPayment: mocks.reconcile }));

const body = JSON.stringify({
  event: "payment.captured", payload: { payment: { entity: { id: "pay_synthetic", order_id: "order_synthetic" } } },
});
const request = (raw = body) => new Request("https://example.test/api/webhooks/razorpay", {
  method: "POST", headers: { "x-razorpay-signature": "signed" }, body: raw,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "synthetic-secret");
  mocks.verify.mockReturnValue(true);
  mocks.booking.mockResolvedValue({ id: "synthetic-booking", guestId: "owner", source: "ONLINE" });
  mocks.reconcile.mockResolvedValue({ ok: true, paid: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Razorpay webhook", () => {
  it("checks the exact raw body and reconciles the order without a guest cookie", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(body, "signed");
    expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ where: { razorpayOrderId: "order_synthetic" } }));
    expect(mocks.reconcile).toHaveBeenCalledWith("synthetic-booking", "owner");
  });

  it("rejects unauthenticated requests before looking up or changing bookings", async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("ignores another application's order and unrelated event types", async () => {
    mocks.booking.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request(JSON.stringify({ event: "payment.failed" })))).status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.booking).toHaveBeenCalledOnce();
  });

  it("rejects malformed signed payloads", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ event: "payment.captured" })))).status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate after an admin cancelled an already-recorded payment, without restoring the booking", async () => {
    mocks.booking.mockResolvedValue({
      id: "synthetic-booking", guestId: "owner", source: "ONLINE",
      status: "CANCELLED", razorpayPaymentId: "pay_synthetic",
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("asks Razorpay to retry when its capture is not available or the database/gateway fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reconcile.mockResolvedValueOnce({ ok: true, paid: false })
      .mockRejectedValueOnce(new Error("Gateway unavailable"))
      .mockResolvedValueOnce({ ok: false, error: "Payment mismatch" });
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(503);
    expect(error).toHaveBeenCalledTimes(3);
  });
});
