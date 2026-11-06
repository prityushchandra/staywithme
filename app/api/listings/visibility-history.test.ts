import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { PATCH } from "./[id]/route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listing: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  listingImage: { deleteMany: vi.fn() },
  listingAmenity: { deleteMany: vi.fn() },
  transaction: vi.fn(),
  getAmenityIdByKey: vi.fn(),
  createUniqueRefCode: vi.fn(),
  expandMapsShortLink: vi.fn(),
  notifyAdminNewListing: vi.fn(),
  notifyAdminListingUpdated: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    listing: mocks.listing,
    listingImage: mocks.listingImage,
    listingAmenity: mocks.listingAmenity,
    $transaction: mocks.transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/memo", () => ({ clearMemo: vi.fn() }));
vi.mock("@/lib/search", () => ({ getAmenityIdByKey: mocks.getAmenityIdByKey }));
vi.mock("@/lib/refcode", () => ({ createUniqueRefCode: mocks.createUniqueRefCode }));
vi.mock("@/lib/maps", () => ({ expandMapsShortLink: mocks.expandMapsShortLink }));
vi.mock("@/lib/bookings", () => ({
  notifyAdminNewListing: mocks.notifyAdminNewListing,
  notifyAdminListingUpdated: mocks.notifyAdminListingUpdated,
}));

const id = "synthetic-listing";
const input = {
  title: "Synthetic test apartment",
  description: "A synthetic apartment used only in mocked route tests.",
  propertyType: "APARTMENT",
  roomType: "ENTIRE",
  addressLine: "Synthetic Society",
  city: "Bengaluru",
  country: "India",
  flatNumber: "T1234",
  block: "Test block",
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  maxGuests: 2,
  basePriceRupees: 2400,
  cancellationPolicy: "FLEXIBLE",
  imageUrls: ["https://example.com/test.jpg"],
};
let stored: {
  id: string; hostId: string; status: string; isVisible: boolean;
  rejectionReason: string | null; refCode: string; guestFavorite: boolean;
  minimumNights: number | null; monthlyStayDiscount: number | null;
  faqs: { question: string; answer: string }[];
};

function request(method: "POST" | "PATCH", extra: Record<string, unknown> = {}) {
  return new Request(`http://localhost/api/listings/${id}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...extra }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T18:30:00Z"));
  stored = {
    id, hostId: "host", status: "PUBLISHED", isVisible: false, rejectionReason: null,
    refCode: "TEST1", guestFavorite: false,
    minimumNights: null, monthlyStayDiscount: null,
    faqs: [{ question: "Existing question?", answer: "Existing answer." }],
  };
  mocks.auth.mockResolvedValue({ user: { id: "host", isAdmin: true, roles: ["HOST"] } });
  mocks.getAmenityIdByKey.mockResolvedValue({});
  mocks.createUniqueRefCode.mockResolvedValue("TEST1");
  mocks.expandMapsShortLink.mockResolvedValue(null);
  mocks.listing.create.mockImplementation(async ({ data }) => ({ id, ...data }));
  mocks.listing.findUnique.mockImplementation(async () => ({ ...stored }));
  mocks.listing.update.mockImplementation(async ({ data }) => {
    const { faqs, ...fields } = data;
    stored = {
      ...stored,
      ...fields,
      ...(faqs ? {
        faqs: faqs.create.map(({ question, answer }: { question: string; answer: string }) => ({ question, answer })),
      } : {}),
    };
    return stored;
  });
  mocks.transaction.mockImplementation(async (operations) => Promise.all(operations));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("listing minimum stay persistence", () => {
  it("stores the configured minimum and converts the one-time offer to paise on create and edit", async () => {
    const terms = { minimumNights: 30, monthlyStayDiscountRupees: 5000 };
    expect((await POST(request("POST", terms))).status).toBe(201);
    expect(mocks.listing.create.mock.calls[0][0].data).toMatchObject({
      minimumNights: 30, monthlyStayDiscount: 500000,
    });
    expect((await PATCH(request("PATCH", terms), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(stored).toMatchObject({ minimumNights: 30, monthlyStayDiscount: 500000 });
  });

  it("preserves saved terms for an older client and supports explicitly removing them", async () => {
    stored.minimumNights = 30;
    stored.monthlyStayDiscount = 500000;
    expect((await PATCH(request("PATCH"), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(stored).toMatchObject({ minimumNights: 30, monthlyStayDiscount: 500000 });
    expect((await PATCH(request("PATCH", { minimumNights: 0, monthlyStayDiscountRupees: 0 }), {
      params: Promise.resolve({ id }),
    })).status).toBe(200);
    expect(stored).toMatchObject({ minimumNights: null, monthlyStayDiscount: null });
  });

  it("rejects price edits that would invalidate a saved discount before any writes", async () => {
    stored.minimumNights = 30;
    stored.monthlyStayDiscount = 500000;
    const response = await PATCH(request("PATCH", { monthlyPriceRupees: 4000 }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    expect(mocks.listing.update).not.toHaveBeenCalled();
    expect(mocks.listingImage.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listing FAQ persistence", () => {
  const faqs = [
    { question: "Can I arrive early?", answer: "Please ask before arrival." },
    { question: "Is parking available?", answer: "Please check space availability." },
  ];

  it("stores ordered FAQs with new listings", async () => {
    const response = await POST(request("POST", { faqs }));
    expect(response.status).toBe(201);
    expect(mocks.listing.create.mock.calls[0][0].data.faqs).toEqual({
      create: faqs.map((faq, position) => ({ ...faq, position })),
    });
  });

  it("replaces FAQs when they are supplied in an edit", async () => {
    const response = await PATCH(request("PATCH", { faqs }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(mocks.listing.update.mock.calls[0][0].data.faqs).toEqual({
      deleteMany: {},
      create: faqs.map((faq, position) => ({ ...faq, position })),
    });
    expect(stored.faqs).toEqual(faqs);
  });

  it("preserves FAQs for older clients and clears them only for an explicit empty list", async () => {
    const previous = structuredClone(stored.faqs);
    const response = await PATCH(request("PATCH"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(mocks.listing.update.mock.calls[0][0].data).not.toHaveProperty("faqs");
    expect(stored.faqs).toEqual(previous);

    const cleared = await PATCH(request("PATCH", { faqs: [] }), { params: Promise.resolve({ id }) });
    expect(cleared.status).toBe(200);
    expect(mocks.listing.update.mock.calls[1][0].data.faqs).toEqual({ deleteMany: {}, create: [] });
    expect(stored.faqs).toEqual([]);
  });

  it("rejects an unanswered FAQ before either create or edit writes", async () => {
    const invalid = { faqs: [{ question: "An unanswered question?", answer: " " }] };
    const created = await POST(request("POST", invalid));
    const edited = await PATCH(request("PATCH", invalid), { params: Promise.resolve({ id }) });
    expect(created.status).toBe(400);
    expect(edited.status).toBe(400);
    expect(mocks.listing.create).not.toHaveBeenCalled();
    expect(mocks.listing.update).not.toHaveBeenCalled();
  });
});

describe("listing lifecycle visibility history", () => {
  it("creates a pending listing and its excluded reporting-month baseline in the same write", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(201);
    expect(mocks.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PENDING",
        visibilityMonths: { create: { month: "2026-11", isVisible: false } },
      }),
    });
  });

  it("records a host edit returning to moderation without changing the independent hidden flag", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "host", isAdmin: false, roles: ["HOST"] } });
    const response = await PATCH(request("PATCH"), { params: Promise.resolve({ id }) });
    expect(await response.json()).toEqual({ id, status: "PENDING" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.listing.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({
        status: "PENDING",
        rejectionReason: null,
        visibilityMonths: {
          upsert: {
            where: { listingId_month: { listingId: id, month: "2026-11" } },
            create: { month: "2026-11", isVisible: false },
            update: { isVisible: false },
          },
        },
      }),
    });
    expect(mocks.listing.update.mock.calls[0][0].data).not.toHaveProperty("isVisible");
    expect(stored.isVisible).toBe(false);
  });

  it("keeps concurrent moderation and visibility history untouched during an admin metadata edit", async () => {
    mocks.expandMapsShortLink.mockImplementation(async () => {
      stored.status = "REJECTED";
      stored.rejectionReason = "Concurrent moderation";
      return null;
    });
    const response = await PATCH(request("PATCH"), { params: Promise.resolve({ id }) });
    expect(await response.json()).toEqual({ id, status: "REJECTED" });
    const data = mocks.listing.update.mock.calls[0][0].data;
    for (const field of ["status", "rejectionReason", "isVisible", "visibilityMonths"]) {
      expect(data).not.toHaveProperty(field);
    }
    expect(stored).toMatchObject({ status: "REJECTED", rejectionReason: "Concurrent moderation", isVisible: false });
  });
});
