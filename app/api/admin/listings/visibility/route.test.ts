import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { PATCH } from "../[id]/route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listing: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  revalidateTag: vi.fn(), revalidatePath: vi.fn(), clearMemo: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { listing: mocks.listing } }));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/memo", () => ({ clearMemo: mocks.clearMemo }));

const id = "synthetic-listing";
const params = () => ({ params: Promise.resolve({ id }) });
function request(body: unknown) {
  return new Request(`http://localhost/api/admin/listings/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  mocks.auth.mockResolvedValue({ user: { isAdmin: true } });
  mocks.listing.findUnique.mockResolvedValue({ id, status: "PUBLISHED", isVisible: true });
  mocks.listing.update.mockImplementation(async ({ data }: { data: { isVisible?: boolean } }) => data);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function monthWrite(month: string, isVisible: boolean) {
  return {
    upsert: {
      where: { listingId_month: { listingId: id, month } },
      create: { month, isVisible },
      update: { isVisible },
    },
  };
}

describe("homepage listing visibility", () => {
  it.each([null, { user: { isAdmin: false } }])("denies non-admin reads and changes before querying listings", async (session) => {
    mocks.auth.mockResolvedValue(session);
    expect((await GET()).status).toBe(403);
    expect((await PATCH(request({ action: "setVisibility", visible: false }), params())).status).toBe(403);
    expect(mocks.listing.findMany).not.toHaveBeenCalled();
    expect(mocks.listing.findUnique).not.toHaveBeenCalled();
    expect(mocks.listing.update).not.toHaveBeenCalled();
  });

  it("privately lists visible and hidden published stays using metadata only", async () => {
    const listings = [
      { id, title: "Visible stay", isVisible: true },
      { id: "synthetic-hidden", title: "Hidden stay", isVisible: false },
    ];
    mocks.listing.findMany.mockResolvedValue(listings);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ listings });
    expect(mocks.listing.findMany).toHaveBeenCalledWith({
      where: { status: "PUBLISHED" },
      select: { id: true, title: true, isVisible: true },
      orderBy: { createdAt: "desc" },
    });
  });

  it.each([false, true])("idempotently saves visibility=%s without changing publication, curation or bookings", async (visible) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await PATCH(request({ action: "setVisibility", visible }), params());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, isVisible: visible });
    }
    expect(mocks.listing.update).toHaveBeenCalledTimes(2);
    expect(mocks.listing.update).toHaveBeenLastCalledWith({
      where: { id, status: "PUBLISHED" },
      data: { isVisible: visible, visibilityMonths: monthWrite("2026-11", visible) },
      select: { isVisible: true },
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("listings");
    expect(mocks.clearMemo).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/search");
  });

  it.each([undefined, "false", 0, null])("rejects missing or non-boolean target %s", async (visible) => {
    const response = await PATCH(request({ action: "setVisibility", visible }), params());
    expect(response.status).toBe(400);
    expect(mocks.listing.findUnique).not.toHaveBeenCalled();
    expect(mocks.listing.update).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing listing", async () => {
    mocks.listing.findUnique.mockResolvedValue(null);
    expect((await PATCH(request({ action: "setVisibility", visible: true }), params())).status).toBe(404);
    expect(mocks.listing.update).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "PENDING", "APPROVED", "REJECTED"])("does not publish a %s listing through the toggle", async (status) => {
    mocks.listing.findUnique.mockResolvedValue({ id, status });
    expect((await PATCH(request({ action: "setVisibility", visible: true }), params())).status).toBe(409);
    expect(mocks.listing.update).not.toHaveBeenCalled();
  });

  it("handles a concurrent unpublish without overriding moderation", async () => {
    mocks.listing.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Record no longer matches", {
      code: "P2025", clientVersion: "test",
    }));
    const response = await PATCH(request({ action: "setVisibility", visible: true }), params());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("no longer published");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("reports and logs a failed write instead of acknowledging a change", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listing.update.mockRejectedValue(new Error("Synthetic database failure"));
    const response = await PATCH(request({ action: "setVisibility", visible: false }), params());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update listing visibility. Please retry." });
    expect(log).toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("stores the month's final state atomically across repeated toggles without replacing an earlier month", async () => {
    const history = new Map([["2026-10", true]]);
    mocks.listing.update.mockImplementation(async ({ data }) => {
      const { upsert } = data.visibilityMonths;
      const { month, listingId } = upsert.where.listingId_month;
      expect(listingId).toBe(id);
      history.set(month, history.has(month) ? upsert.update.isVisible : upsert.create.isVisible);
      return { isVisible: data.isVisible };
    });
    for (const visible of [false, true, false]) {
      expect((await PATCH(request({ action: "setVisibility", visible }), params())).status).toBe(200);
    }
    expect([...history]).toEqual([["2026-10", true], ["2026-11", false]]);
    vi.setSystemTime(new Date("2027-01-15T12:00:00Z"));
    expect((await PATCH(request({ action: "setVisibility", visible: true }), params())).status).toBe(200);
    expect([...history]).toEqual([["2026-10", true], ["2026-11", false], ["2027-01", true]]);
  });

  it("changes the tracked month exactly at India midnight", async () => {
    vi.setSystemTime(new Date("2026-10-31T18:29:59.999Z"));
    await PATCH(request({ action: "setVisibility", visible: false }), params());
    vi.setSystemTime(new Date("2026-10-31T18:30:00Z"));
    await PATCH(request({ action: "setVisibility", visible: true }), params());
    expect(mocks.listing.update).toHaveBeenNthCalledWith(1, {
      where: { id, status: "PUBLISHED" },
      data: { isVisible: false, visibilityMonths: monthWrite("2026-10", false) },
      select: { isVisible: true },
    });
    expect(mocks.listing.update).toHaveBeenNthCalledWith(2, {
      where: { id, status: "PUBLISHED" },
      data: { isVisible: true, visibilityMonths: monthWrite("2026-11", true) },
      select: { isVisible: true },
    });
  });

  it.each([false, true])("approves with effective visibility=%s without auto-showing a hidden listing", async (isVisible) => {
    mocks.listing.findUnique.mockResolvedValue({ id, status: "PENDING", isVisible });
    expect((await PATCH(request({ action: "approve" }), params())).status).toBe(200);
    expect(mocks.listing.update).toHaveBeenCalledWith({
      where: { id, isVisible },
      data: {
        status: "PUBLISHED", rejectionReason: null,
        visibilityMonths: monthWrite("2026-11", isVisible),
      },
    });
  });

  it("rejects approval's stale visibility snapshot rather than recording the wrong monthly state", async () => {
    mocks.listing.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Visibility changed", {
      code: "P2025", clientVersion: "test",
    }));
    const response = await PATCH(request({ action: "approve" }), params());
    expect(response.status).toBe(409);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    { input: { action: "unpublish" }, data: { status: "PENDING", featured: false } },
    { input: { action: "reject", reason: " Not ready " }, data: { status: "REJECTED", rejectionReason: "Not ready" } },
  ])("tracks $input.action as unlisted without changing the independent visibility toggle", async ({ input, data }) => {
    expect((await PATCH(request(input), params())).status).toBe(200);
    expect(mocks.listing.update).toHaveBeenCalledWith({
      where: { id }, data: { ...data, visibilityMonths: monthWrite("2026-11", false) },
    });
  });

  it.each([
    { input: { action: "feature" }, data: { featured: true } },
    { input: { action: "unfeature" }, data: { featured: false } },
    { input: { action: "setHostName", hostDisplayName: " Host " }, data: { hostDisplayName: "Host" } },
  ])("preserves the existing $input.action action", async ({ input, data }) => {
    const response = await PATCH(request(input), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.listing.update).toHaveBeenCalledWith({ where: { id }, data });
  });
});
