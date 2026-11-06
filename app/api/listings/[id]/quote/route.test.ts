import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  listing: vi.fn(), blocks: vi.fn(), settings: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    listing: { findUnique: mocks.listing },
    availabilityBlock: { findMany: mocks.blocks },
    platformSettings: { findUnique: mocks.settings },
  },
}));

const listing = {
  status: "PUBLISHED", basePrice: 200000, discountedPrice: 150000, monthlyPrice: 3000000,
  minimumNights: 30, monthlyStayDiscount: 500000,
};
const checkIn = new Date("2027-03-01T00:00:00Z");

function quote(nights: number) {
  return POST(new Request("http://localhost/api/listings/synthetic/quote", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkIn: checkIn.toISOString(),
      checkOut: new Date(checkIn.getTime() + nights * 86_400_000).toISOString(),
    }),
  }), { params: Promise.resolve({ id: "synthetic" }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listing.mockResolvedValue(listing);
  mocks.blocks.mockResolvedValue([]);
  mocks.settings.mockResolvedValue({ platformFeePercent: 10 });
});

describe("live stay quote", () => {
  it("quotes all 44 nights at the entered 30-night rate plus the Platform Fee, with no second discount", async () => {
    mocks.listing.mockResolvedValue({ ...listing, monthlyStayDiscount: null });
    expect(await (await quote(44)).json()).toMatchObject({
      bookable: true, nights: 44, monthlyPrice: 3000000, monthlyStayDiscount: null, total: 4840000,
    });
  });

  it("returns the current minimum and an explicit refusal, not a total, for short stays", async () => {
    const response = await quote(29);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      bookable: false, total: null, minimumNights: 30, monthlyStayDiscount: 500000,
      error: "Minimum 30 nights. Please choose a longer stay.",
    });
  });

  it.each([[30, 2800000], [31, 2910000], [60, 6100000]])(
    "quotes %i nights from fresh database prices with one fixed discount",
    async (nights, total) => {
      expect(await (await quote(nights)).json()).toMatchObject({ bookable: true, total, nights });
    }
  );

  it("retains availability and publication gates for eligible monthly stays", async () => {
    mocks.blocks.mockResolvedValue([{ startDate: new Date("2027-03-10"), endDate: new Date("2027-03-12") }]);
    expect(await (await quote(30)).json()).toMatchObject({ available: false, bookable: false });
    mocks.listing.mockResolvedValue({ ...listing, status: "DRAFT" });
    expect((await quote(30)).status).toBe(404);
  });

  it("preserves ordinary one-night quotes with no minimum or extra offer", async () => {
    mocks.listing.mockResolvedValue({ ...listing, minimumNights: null, monthlyStayDiscount: null });
    expect(await (await quote(1)).json()).toMatchObject({ bookable: true, total: 165000 });
  });
});
