import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), booking: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { booking: { findUnique: mocks.booking } } }));
vi.mock("@/lib/online-bookings", () => ({
  reconcileBookingPayment: mocks.reconcile, approveOnlineBooking: vi.fn(), rejectOnlineBooking: vi.fn(),
}));
vi.mock("@/lib/bookings", () => ({ confirmBooking: vi.fn(), cancelBooking: vi.fn() }));

const request = () => new Request("https://example.test/api/admin/bookings/synthetic", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile" }),
});
const params = () => ({ params: Promise.resolve({ id: "synthetic" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { isAdmin: true } });
  mocks.booking.mockResolvedValue({ guestId: "owner", source: "ONLINE" });
  mocks.reconcile.mockResolvedValue({ ok: true, paid: true });
});
afterEach(() => vi.restoreAllMocks());

describe("admin payment recovery", () => {
  it.each([null, { user: { id: "guest", isAdmin: false } }])("requires an admin session", async (session) => {
    mocks.auth.mockResolvedValue(session);
    expect((await PATCH(request(), params())).status).toBe(403);
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("uses the booking owner from the database, not the caller's identity", async () => {
    expect((await PATCH(request(), params())).status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith("synthetic", "owner");
  });

  it("refuses a non-online booking", async () => {
    mocks.booking.mockResolvedValue({ guestId: "owner", source: "WHATSAPP" });
    expect((await PATCH(request(), params())).status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("surfaces a provider outage instead of returning an unpaid success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reconcile.mockRejectedValue(new Error("Provider unavailable"));
    const response = await PATCH(request(), params());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("do not request another payment") });
    expect(log).toHaveBeenCalledOnce();
  });
});
