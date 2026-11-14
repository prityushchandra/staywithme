import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { PATCH } from "./[id]/route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    listing: { findUnique: vi.fn() },
    listingCoupon: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));

const input = { listingId: "listing", code: "single-stay", kind: "DAILY", amount: 120000 };
const params = { params: Promise.resolve({ id: "coupon" }) };
const request = (body: unknown) => new Request("http://localhost/api/admin/coupons", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin", isAdmin: true } });
  mocks.db.listing.findUnique.mockResolvedValue({ status: "PUBLISHED", basePrice: 200000 });
  mocks.db.listingCoupon.create.mockResolvedValue({ id: "coupon", code: "SINGLE-STAY" });
  mocks.db.listingCoupon.findUnique.mockResolvedValue({ reservation: null });
  mocks.db.$transaction.mockImplementation(async (run) => run(mocks.db));
});

describe("admin coupon management", () => {
  it.each([null, { user: { id: "guest", isAdmin: false } }])("requires an administrator before any create or toggle", async (session) => {
    mocks.auth.mockResolvedValue(session);
    expect((await POST(request(input))).status).toBe(403);
    expect((await PATCH(request({ active: false }), params)).status).toBe(403);
    expect(mocks.db.listing.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("creates a normalized listing-specific price and can generate a code", async () => {
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.db.listingCoupon.create).toHaveBeenLastCalledWith({
      data: { ...input, code: "SINGLE-STAY" }, select: { id: true, code: true },
    });
    expect((await POST(request({ listingId: "listing", kind: "MONTHLY", amount: 3000000 }))).status).toBe(201);
    expect(mocks.db.listingCoupon.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ code: expect.stringMatching(/^SWM-[A-F0-9]{8}$/), kind: "MONTHLY", amount: 3000000 }),
    }));
  });

  it.each([
    { amount: 0 }, { amount: 120000.5 }, { code: "bad code" }, { amount: 200000 },
    { kind: "MONTHLY", amount: 6000000 },
  ])("rejects invalid codes, amounts and non-discounts: %j", async (changes) => {
    expect((await POST(request({ ...input, ...changes }))).status).toBe(400);
    expect(mocks.db.listingCoupon.create).not.toHaveBeenCalled();
  });

  it("rejects unpublished listings and duplicate codes without replacing an existing coupon", async () => {
    mocks.db.listing.findUnique.mockResolvedValueOnce({ status: "DRAFT", basePrice: 200000 });
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.db.listingCoupon.create).not.toHaveBeenCalled();
    mocks.db.listingCoupon.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Duplicate code", {
      code: "P2002", clientVersion: "test",
    }));
    expect((await POST(request(input))).status).toBe(409);
  });

  it("locks an unused coupon while pausing it and refuses to change reserved codes", async () => {
    expect((await PATCH(request({ active: false }), params)).status).toBe(200);
    expect(mocks.db.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.db.listingCoupon.update).toHaveBeenCalledWith({ where: { id: "coupon" }, data: { active: false } });
    mocks.db.listingCoupon.update.mockClear();
    mocks.db.listingCoupon.findUnique.mockResolvedValue({ reservation: { couponId: "coupon" } });
    expect((await PATCH(request({ active: true }), params)).status).toBe(409);
    expect(mocks.db.listingCoupon.update).not.toHaveBeenCalled();
  });
});
