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
  mocks.auth.mockResolvedValue({ user: { isAdmin: true } });
  mocks.listing.findUnique.mockResolvedValue({ id, status: "PUBLISHED" });
  mocks.listing.update.mockImplementation(async ({ data }: { data: { isVisible?: boolean } }) => data);
});
afterEach(() => vi.restoreAllMocks());

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
      where: { id, status: "PUBLISHED" }, data: { isVisible: visible }, select: { isVisible: true },
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

  it.each([
    { input: { action: "approve" }, data: { status: "PUBLISHED", rejectionReason: null } },
    { input: { action: "unpublish" }, data: { status: "PENDING", featured: false } },
    { input: { action: "setHostName", hostDisplayName: " Host " }, data: { hostDisplayName: "Host" } },
  ])("preserves the existing $input.action action", async ({ input, data }) => {
    const response = await PATCH(request(input), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.listing.update).toHaveBeenCalledWith({ where: { id }, data });
  });
});
