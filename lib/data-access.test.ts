import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import {
  getPublishedListings, getFeaturedListings, getPublishedListingsByIds, getPublishedListingById,
} from "./data-access";
import { searchListings } from "./search";
import { clearMemo } from "./memo";

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  listing: { findMany: vi.fn(), findFirst: vi.fn() },
  settings: vi.fn(),
}));
vi.mock("./db", () => ({
  prisma: { listing: mocks.listing, platformSettings: { findUnique: mocks.settings } },
}));
vi.mock("./analytics", () => ({ getListingStats: vi.fn(async () => new Map()) }));
vi.mock("./ranking", () => ({ rankListings: (listings: unknown[]) => listings }));
vi.mock("next/cache", () => ({
  unstable_cache: (read: (...args: unknown[]) => Promise<unknown>, keys: string[]) => async (...args: unknown[]) => {
    const key = JSON.stringify([keys, args]);
    if (!mocks.cache.has(key)) mocks.cache.set(key, await read(...args));
    return mocks.cache.get(key);
  },
  revalidateTag: () => mocks.cache.clear(),
}));

const fixture = () => [
  { id: "visible", status: "PUBLISHED", isVisible: true, featured: true, images: [{ url: "cover" }] },
  { id: "hidden", status: "PUBLISHED", isVisible: false, featured: true, images: [{ url: "hidden-cover" }] },
  { id: "draft", status: "DRAFT", isVisible: true, featured: true, images: [] },
];
let rows = fixture();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  clearMemo();
  rows = fixture();
  mocks.settings.mockResolvedValue(null);
  mocks.listing.findMany.mockImplementation(async ({ where }: {
    where: { status?: string; isVisible?: boolean; featured?: boolean; id?: { in: string[] } };
  }) => rows.filter((row) =>
    (!where.status || row.status === where.status) &&
    (where.isVisible === undefined || row.isVisible === where.isVisible) &&
    (where.featured === undefined || row.featured === where.featured) &&
    (!where.id || where.id.in.includes(row.id))
  ));
});

describe.each([
  { name: "homepage", read: () => getPublishedListings({ take: 24 }) },
  { name: "featured stays", read: () => getFeaturedListings() },
  { name: "search", read: () => searchListings({ guests: 2 }, 10) },
  { name: "saved stays", read: () => getPublishedListingsByIds(["visible", "hidden", "draft"]) },
])("$name guest visibility", ({ read }) => {
  it("excludes hidden and unpublished stays from discovery", async () => {
    expect((await read()).map((listing) => listing.id)).toEqual(["visible"]);
    expect(mocks.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PUBLISHED", isVisible: true }),
    }));
  });

  it("reflects hide and restore after shared invalidation without clearing this instance's memo", async () => {
    expect((await read()).map((listing) => listing.id)).toEqual(["visible"]);
    rows[0] = { ...rows[0], isVisible: false };
    revalidateTag("listings");
    expect(await read()).toEqual([]);
    rows[0] = { ...rows[0], isVisible: true };
    revalidateTag("listings");
    expect((await read()).map((listing) => listing.id)).toEqual(["visible"]);
  });
});

it("preserves direct access to a published hidden stay instead of cancelling its booking flow", async () => {
  mocks.listing.findFirst.mockResolvedValue(rows[1]);
  expect((await getPublishedListingById("hidden"))?.id).toBe("hidden");
  expect(mocks.listing.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "hidden", status: "PUBLISHED" },
  }));
});
