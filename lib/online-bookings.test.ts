import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingOrder, startOnlineBooking, quoteStay } from "./online-bookings";
import type { GuestDocumentRecord } from "./booking-documents";

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  settings: vi.fn(),
  db: {
    booking: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    bookingGuest: { findMany: vi.fn() },
    listing: { findUnique: vi.fn() },
    availabilityBlock: { findMany: vi.fn() },
  },
}));
vi.mock("./db", () => ({ prisma: mocks.db }));
vi.mock("./settings", () => ({ getPlatformSettings: mocks.settings }));
vi.mock("./razorpay", () => ({ createRazorpayOrder: mocks.createOrder }));
vi.mock("./wa-send", () => ({ sendWhatsApp: vi.fn(), sendNotification: vi.fn() }));
vi.mock("./bookings", () => ({ unitBlock: vi.fn() }));
vi.mock("./memo", () => ({ clearMemo: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const scan = (id: string) => ({ id, docName: `${id}.pdf`, docSize: 20 });
const guest = (position: number | null, documents: GuestDocumentRecord["documents"] = []): GuestDocumentRecord => ({
  id: `guest-${position}`, position, name: "Synthetic Guest", docName: null, docSize: 0, documents,
});
const booking = {
  id: "synthetic-booking", guestId: "owner", listingId: "flat", guests: 2, status: "PENDING",
  checkIn: new Date("2027-03-10T00:00:00Z"), checkOut: new Date("2027-03-12T00:00:00Z"),
  reasonForVisit: "Synthetic visit", razorpayOrderId: null, idDocs: [guest(0), guest(1)],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ platformFeePercent: 0 });
  mocks.db.booking.findUnique.mockResolvedValue(booking);
  mocks.db.booking.findFirst.mockResolvedValue({ id: booking.id });
  mocks.db.booking.update.mockResolvedValue({ id: booking.id });
  mocks.db.bookingGuest.findMany.mockResolvedValue([]);
  mocks.db.listing.findUnique.mockResolvedValue({
    title: "Example listing", status: "PUBLISHED", basePrice: 100000, discountedPrice: null, monthlyPrice: null,
  });
  mocks.db.availabilityBlock.findMany.mockResolvedValue([]);
  mocks.createOrder.mockResolvedValue({ id: "mock-order-only", amount: 200000 });
});

describe("online minimum stay and monthly offer", () => {
  const listing = {
    title: "Synthetic monthly stay", status: "PUBLISHED",
    basePrice: 200000, discountedPrice: 150000, monthlyPrice: 3000000,
    minimumNights: 30, monthlyStayDiscount: 50000,
  };
  const checkIn = new Date("2027-03-01T00:00:00Z");
  const checkout = (nights: number) => new Date(checkIn.getTime() + nights * 86_400_000);

  it("persists and charges the prorated 44-night total without subtracting the advertised saving again", async () => {
    mocks.settings.mockResolvedValue({ platformFeePercent: 10 });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, monthlyStayDiscount: null });
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn, checkOut: checkout(44), guests: 2,
    })).toMatchObject({ ok: true, total: 4840000 });
    expect(mocks.db.booking.update.mock.calls[0][0].data.totalAmount).toBe(4840000);
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, checkIn, checkOut: checkout(44), idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.createOrder.mockImplementation(async (amount) => ({ id: "mock-order-only", amount }));
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({ ok: true, amount: 4840000 });
    expect(mocks.createOrder.mock.calls[0][0]).toBe(4840000);
  });

  it("rejects a short direct request before creating or reusing a draft", async () => {
    mocks.db.listing.findUnique.mockResolvedValue(listing);
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn, checkOut: checkout(29), guests: 2,
    })).toEqual({ ok: false, error: "Minimum 30 nights. Please choose a longer stay." });
    expect(mocks.db.booking.create).not.toHaveBeenCalled();
    expect(mocks.db.booking.update).not.toHaveBeenCalled();
    expect(mocks.db.booking.findFirst).not.toHaveBeenCalled();
  });

  it.each([[30, 3250000], [31, 3360000], [60, 6550000]])(
    "quotes %i nights with one fixed discount after the existing monthly rate and fee",
    async (nights, total) => {
      mocks.settings.mockResolvedValue({ platformFeePercent: 10 });
      mocks.db.listing.findUnique.mockResolvedValue(listing);
      expect(await quoteStay("flat", checkIn, checkout(nights))).toMatchObject({ ok: true, total, nights });
    }
  );

  it("rejects a previously started draft if the minimum increases before payment", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, checkIn, checkOut: checkout(30), idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, minimumNights: 31 });
    expect((await createBookingOrder(booking.id, "owner")).ok).toBe(false);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.booking.update).not.toHaveBeenCalled();
  });

  it("persists the discounted draft total and rechecks the current offer before taking payment", async () => {
    mocks.settings.mockResolvedValue({ platformFeePercent: 10 });
    mocks.db.listing.findUnique.mockResolvedValue(listing);
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn, checkOut: checkout(30), guests: 2,
    })).toMatchObject({ ok: true, total: 3250000 });
    expect(mocks.db.booking.update.mock.calls[0][0].data.totalAmount).toBe(3250000);

    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, checkIn, checkOut: checkout(30), idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, monthlyStayDiscount: 100000 });
    mocks.createOrder.mockImplementation(async (amount) => ({ id: "mock-order-only", amount }));
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({ ok: true, amount: 3200000 });
    expect(mocks.createOrder.mock.calls[0][0]).toBe(3200000);
    expect(mocks.db.booking.update.mock.calls[1][0].data.totalAmount).toBe(3200000);
  });
});

describe("payment requires an ID for every guest", () => {
  it.each([
    [guest(0, [scan("front"), scan("back")]), guest(1)],
    [guest(0), guest(1, [scan("one"), scan("two")])],
    [guest(1, [scan("second")]), guest(2, [scan("outside-count")])],
  ])("does not count multiple files or excluded positions as missing guests' IDs", async (...idDocs) => {
    mocks.db.booking.findUnique.mockResolvedValue({ ...booking, idDocs });
    expect(await createBookingOrder(booking.id, "owner")).toEqual({
      ok: false, error: "Please upload an ID for every guest before paying.",
    });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.booking.update).not.toHaveBeenCalled();
  });

  it("accepts legacy IDs and additional attachments once every guest has an ID", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, idDocs: [
        { ...guest(null, [scan("extra")]), id: "old-first", docName: "legacy-front.pdf", docSize: 20 },
        { ...guest(null), id: "old-second", docName: "legacy-second.pdf", docSize: 20 },
      ],
    });
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({ ok: true, razorpayOrderId: "mock-order-only" });
    expect(mocks.createOrder).toHaveBeenCalledOnce();
  });

  it("still rejects another owner's draft and an already-paid booking before creating an order", async () => {
    expect((await createBookingOrder(booking.id, "not-owner")).ok).toBe(false);
    mocks.db.booking.findUnique.mockResolvedValue({ ...booking, status: "AWAITING_APPROVAL" });
    expect((await createBookingOrder(booking.id, "owner")).ok).toBe(false);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
});

describe("reopening an online draft", () => {
  it("returns all attachments with stable guest positions and no document bytes", async () => {
    mocks.db.bookingGuest.findMany.mockResolvedValue([
      { ...guest(null, [scan("back")]), id: "legacy-first", docName: "front.pdf", docSize: 20 },
      guest(1, [scan("companion")]),
    ]);
    const result = await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn: booking.checkIn, checkOut: booking.checkOut, guests: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.docs.map((doc) => [doc.id, doc.position])).toEqual([
      ["legacy-first", 0], ["back", 0], ["companion", 1],
    ]);
    const select = mocks.db.bookingGuest.findMany.mock.calls[0][0].select;
    expect(select.docData).toBeUndefined();
    expect(select.documents.select.docData).toBeUndefined();
    expect(mocks.db.booking.create).not.toHaveBeenCalled();
  });
});
