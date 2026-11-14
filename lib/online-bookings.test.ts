import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmBookingPayment, createBookingOrder, reconcileBookingPayment, startOnlineBooking, quoteStay } from "./online-bookings";
import type { GuestDocumentRecord } from "./booking-documents";

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchPayment: vi.fn(),
  listPayments: vi.fn(),
  verifySignature: vi.fn(),
  revalidate: vi.fn(),
  settings: vi.fn(),
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    booking: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    bookingGuest: { findMany: vi.fn() },
    listing: { findUnique: vi.fn() },
    platformSettings: { findUnique: vi.fn() },
    listingCoupon: { findUnique: vi.fn() },
    couponReservation: { create: vi.fn() },
    availabilityBlock: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("./db", () => ({ prisma: mocks.db }));
vi.mock("./settings", () => ({ getPlatformSettings: mocks.settings }));
vi.mock("./razorpay", () => ({
  createRazorpayOrder: mocks.createOrder, fetchRazorpayOrder: mocks.fetchOrder, fetchRazorpayPayment: mocks.fetchPayment,
  listRazorpayOrderPayments: mocks.listPayments, verifyRazorpayPaymentSignature: mocks.verifySignature,
}));
vi.mock("./wa-send", () => ({ sendWhatsApp: vi.fn(), sendNotification: vi.fn() }));
vi.mock("./bookings", () => ({ unitBlock: vi.fn() }));
vi.mock("./memo", () => ({ clearMemo: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const scan = (id: string) => ({ id, docName: `${id}.pdf`, docSize: 20 });
const guest = (position: number | null, documents: GuestDocumentRecord["documents"] = []): GuestDocumentRecord => ({
  id: `guest-${position}`, position, name: "Synthetic Guest", docName: null, docSize: 0, documents,
});
const booking = {
  id: "synthetic-booking", guestId: "owner", listingId: "flat", guests: 2, status: "PENDING", source: "ONLINE",
  checkIn: new Date("2027-03-10T00:00:00Z"), checkOut: new Date("2027-03-12T00:00:00Z"),
  reasonForVisit: "Synthetic visit", razorpayOrderId: null, idDocs: [guest(0), guest(1)],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ platformFeePercent: 0 });
  mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 0 });
  mocks.db.booking.findUnique.mockResolvedValue(booking);
  mocks.db.booking.findFirst.mockResolvedValue({ id: booking.id });
  mocks.db.booking.update.mockResolvedValue({ id: booking.id });
  mocks.db.booking.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (run) => run(mocks.db));
  mocks.db.$queryRaw.mockResolvedValue([{ id: "flat" }]);
  mocks.db.bookingGuest.findMany.mockResolvedValue([]);
  mocks.db.listing.findUnique.mockResolvedValue({
    title: "Example listing", status: "PUBLISHED", basePrice: 100000, discountedPrice: null, monthlyPrice: null,
  });
  mocks.db.availabilityBlock.findMany.mockResolvedValue([]);
  mocks.db.availabilityBlock.create.mockResolvedValue({ id: "held-dates" });
  mocks.listPayments.mockResolvedValue([]);
  mocks.verifySignature.mockReturnValue(true);
  mocks.createOrder.mockResolvedValue({ id: "mock-order-only", amount: 200000, currency: "INR", status: "created" });
  mocks.fetchOrder.mockResolvedValue({ id: "order_existing", amount: 200000, currency: "INR", status: "attempted" });
});

describe("captured payment recovery", () => {
  const payment = {
    id: "pay_synthetic", order_id: "order_synthetic", amount: 320000, currency: "INR",
    status: "captured", captured: true, created_at: 1794654000, amount_refunded: 0, fee: 7552, tax: 1152,
  };
  const payload = {
    razorpay_order_id: payment.order_id, razorpay_payment_id: payment.id, razorpay_signature: "signed",
  };

  beforeEach(() => {
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, totalAmount: payment.amount, razorpayOrderId: payment.order_id, guest: { name: "Synthetic Guest" },
    });
    mocks.fetchPayment.mockResolvedValue(payment);
    mocks.listPayments.mockResolvedValue([payment]);
  });

  it("recovers a captured order as awaiting approval, holding dates without creating another charge", async () => {
    expect(await reconcileBookingPayment(booking.id, "owner")).toEqual({ ok: true, paid: true });
    expect(mocks.db.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PENDING", source: "ONLINE", razorpayOrderId: payment.order_id }),
      data: expect.objectContaining({
        status: "AWAITING_APPROVAL", amountPaid: 320000, razorpayPaymentId: payment.id,
        paidAt: new Date(payment.created_at * 1000),
      }),
    }));
    expect(mocks.db.availabilityBlock.create).toHaveBeenCalledOnce();
    expect(mocks.db.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { blockId: "held-dates", adminNote: null },
    }));
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("listings");
  });

  it.each([
    { order_id: "order_unrelated" }, { amount: 319999 }, { currency: "USD" },
    { captured: false }, { amount_refunded: 100 },
  ])("rejects a mismatched or refunded captured payment before changing any booking: %j", async (changes) => {
    mocks.listPayments.mockResolvedValue([{ ...payment, ...changes }]);
    expect((await reconcileBookingPayment(booking.id, "owner")).ok).toBe(false);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not turn a signed but only authorized checkout into a paid booking", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, status: "authorized", captured: false });
    expect((await confirmBookingPayment(booking.id, "owner", payload)).ok).toBe(false);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("reports gateway errors instead of claiming the booking is unpaid or assuming the amount", async () => {
    mocks.listPayments.mockRejectedValue(new Error("Gateway unavailable"));
    await expect(reconcileBookingPayment(booking.id, "owner")).rejects.toThrow("Gateway unavailable");
    mocks.fetchPayment.mockRejectedValue(new Error("Gateway unavailable"));
    await expect(confirmBookingPayment(booking.id, "owner", payload)).rejects.toThrow("Gateway unavailable");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("leaves an order without a capture unpaid", async () => {
    mocks.listPayments.mockResolvedValue([{ ...payment, status: "authorized", captured: false }]);
    expect(await reconcileBookingPayment(booking.id, "owner")).toEqual({ ok: true, paid: false });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not duplicate the hold or notification when another callback already claimed the booking", async () => {
    mocks.db.booking.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.booking.findUnique.mockResolvedValueOnce({
      ...booking, totalAmount: payment.amount, razorpayOrderId: payment.order_id,
    }).mockResolvedValue({ status: "AWAITING_APPROVAL", razorpayPaymentId: payment.id });
    expect(await reconcileBookingPayment(booking.id, "owner")).toEqual({ ok: true, paid: true });
    expect(mocks.db.availabilityBlock.create).not.toHaveBeenCalled();
    expect(mocks.db.booking.update).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("records the money but flags an existing date conflict instead of double-booking", async () => {
    mocks.db.availabilityBlock.findMany.mockResolvedValue([{ id: "existing-hold" }]);
    expect(await reconcileBookingPayment(booking.id, "owner")).toEqual({ ok: true, paid: true });
    expect(mocks.db.availabilityBlock.create).not.toHaveBeenCalled();
    expect(mocks.db.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { blockId: null, adminNote: expect.stringContaining("DATE CONFLICT") },
    }));
  });

  it("does not recover another guest's booking or a cancelled booking", async () => {
    expect((await reconcileBookingPayment(booking.id, "someone-else")).ok).toBe(false);
    mocks.db.booking.findUnique.mockResolvedValue({ ...booking, status: "CANCELLED" });
    expect((await reconcileBookingPayment(booking.id, "owner")).ok).toBe(false);
    expect(mocks.listPayments).not.toHaveBeenCalled();
  });

  it("recovers an existing capture on a checkout retry rather than charging again", async () => {
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({
      ok: false, error: expect.stringContaining("Payment already received"),
    });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.availabilityBlock.create).toHaveBeenCalledOnce();
  });
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
    mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 10 });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, monthlyStayDiscount: null });
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn, checkOut: checkout(44), guests: 2,
    })).toMatchObject({ ok: true, total: 4840000 });
    expect(mocks.db.booking.updateMany.mock.calls[0][0].data.totalAmount).toBe(4840000);
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, checkIn, checkOut: checkout(44), idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.createOrder.mockImplementation(async (amount) => ({ id: "mock-order-only", amount, currency: "INR", status: "created" }));
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
      mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 10 });
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
    mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 10 });
    mocks.db.listing.findUnique.mockResolvedValue(listing);
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", checkIn, checkOut: checkout(30), guests: 2,
    })).toMatchObject({ ok: true, total: 3250000 });
    expect(mocks.db.booking.updateMany.mock.calls[0][0].data.totalAmount).toBe(3250000);
    mocks.db.booking.updateMany.mockClear();

    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, checkIn, checkOut: checkout(30), idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, monthlyStayDiscount: 100000 });
    mocks.createOrder.mockImplementation(async (amount) => ({ id: "mock-order-only", amount, currency: "INR", status: "created" }));
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({ ok: true, amount: 3200000 });
    expect(mocks.createOrder.mock.calls[0][0]).toBe(3200000);
    expect(mocks.db.booking.updateMany.mock.calls[0][0].data.totalAmount).toBe(3200000);
  });
});

describe("coupon checkout pricing", () => {
  const listing = {
    title: "Coupon stay", status: "PUBLISHED", basePrice: 100000,
    discountedPrice: 90000, monthlyPrice: null, minimumNights: 2, monthlyStayDiscount: 5000,
  };
  const coupon = { id: "coupon", listingId: "flat", code: "STAY-ONCE", kind: "DAILY", amount: 80000, active: true, reservation: null };
  const reservation = {
    couponId: coupon.id, bookingId: booking.id, code: coupon.code, kind: "DAILY" as const, amount: 80000,
    baseAmount: 160000, platformFee: 16000, platformFeePercent: 10, regularBase: 200000, regularTotal: 220000,
    createdAt: new Date("2027-01-01"),
  };
  const readyBooking = {
    ...booking, listing, couponReservation: null, totalAmount: 193000,
    idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
  };

  beforeEach(() => {
    mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 10 });
    mocks.db.listing.findUnique.mockResolvedValue(listing);
    mocks.db.listingCoupon.findUnique.mockResolvedValue(coupon);
    mocks.db.booking.findUnique.mockResolvedValue(readyBooking);
    mocks.createOrder.mockImplementation(async (amount) => ({ id: "coupon-order", amount, currency: "INR", status: "created" }));
  });

  it("only previews a coupon until Pay now reserves it and creates an order for that exact total", async () => {
    expect(await quoteStay("flat", booking.checkIn, booking.checkOut, { couponCode: "stay-once" }))
      .toMatchObject({ ok: true, total: 176000, pricing: { base: 160000, platformFee: 16000, monthlyStayDiscount: 0 } });
    expect(mocks.db.couponReservation.create).not.toHaveBeenCalled();
    expect(await createBookingOrder(booking.id, "owner", { couponCode: "stay-once", expectedTotal: 176000 }))
      .toMatchObject({ ok: true, amount: 176000, pricingLocked: true });
    expect(mocks.db.couponReservation.create).toHaveBeenCalledOnce();
    expect(mocks.createOrder).toHaveBeenCalledWith(176000, expect.any(String), expect.objectContaining({ bookingId: booking.id }));
    expect(mocks.db.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ couponReservation: { is: { code: "STAY-ONCE" } } }),
      data: { totalAmount: 176000, razorpayOrderId: "coupon-order" },
    }));
  });

  it("does not reserve a coupon or charge when the guest has not accepted its current total", async () => {
    expect((await createBookingOrder(booking.id, "owner", { couponCode: coupon.code })).ok).toBe(false);
    expect(await createBookingOrder(booking.id, "owner", { couponCode: coupon.code, expectedTotal: 1 }))
      .toMatchObject({ ok: false, pricing: { total: 176000 }, pricingLocked: false });
    expect(mocks.db.couponReservation.create).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("reopens and retries the same locked price even after listing prices and the Platform Fee change", async () => {
    const locked = { ...readyBooking, totalAmount: 176000, couponReservation: reservation, razorpayOrderId: "locked-order" };
    mocks.db.booking.findFirst.mockResolvedValue(locked);
    mocks.db.booking.findUnique.mockResolvedValue(locked);
    mocks.db.platformSettings.findUnique.mockResolvedValue({ platformFeePercent: 25 });
    mocks.db.listing.findUnique.mockResolvedValue({ ...listing, basePrice: 200000, discountedPrice: null });
    mocks.fetchOrder.mockResolvedValue({ id: "locked-order", amount: 176000, currency: "INR", status: "attempted" });
    expect(await startOnlineBooking({
      listingId: "flat", guestId: "owner", guests: 2, checkIn: booking.checkIn, checkOut: booking.checkOut,
    })).toMatchObject({ ok: true, total: 176000, pricingLocked: true, pricing: { platformFeePercent: 10 } });
    expect(await createBookingOrder(booking.id, "owner", { expectedTotal: 176000 }))
      .toMatchObject({ ok: true, amount: 176000, razorpayOrderId: "locked-order" });
    expect(mocks.db.listingCoupon.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.couponReservation.create).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("does not replace or remove a reserved coupon, even if the gateway has not created an order yet", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({ ...readyBooking, totalAmount: 176000, couponReservation: reservation });
    for (const couponCode of [null, "OTHER-CODE"]) {
      expect(await createBookingOrder(booking.id, "owner", { couponCode, expectedTotal: 176000 }))
        .toMatchObject({ ok: false, pricingLocked: true, pricing: { total: 176000 } });
    }
    mocks.db.booking.findFirst.mockResolvedValue({ ...readyBooking, couponReservation: reservation });
    expect((await startOnlineBooking({
      listingId: "flat", guestId: "owner", guests: 3, checkIn: booking.checkIn, checkOut: booking.checkOut,
    })).ok).toBe(false);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.booking.updateMany).not.toHaveBeenCalled();
  });

  it("does not turn a non-coupon payment attempt into a coupon order", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({ ...readyBooking, razorpayOrderId: "original-order" });
    expect((await createBookingOrder(booking.id, "owner", { couponCode: coupon.code, expectedTotal: 176000 })).ok).toBe(false);
    expect(mocks.db.couponReservation.create).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
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
  it("reuses the existing unpaid Razorpay order instead of orphaning a payment in another tab", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, totalAmount: 200000, razorpayOrderId: "order_existing",
      idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    expect(await createBookingOrder(booking.id, "owner")).toMatchObject({
      ok: true, razorpayOrderId: "order_existing", amount: 200000,
    });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.booking.updateMany).not.toHaveBeenCalled();
  });

  it("does not replace an unpaid order when the listing price changes", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      ...booking, totalAmount: 190000, razorpayOrderId: "order_existing",
      idDocs: [guest(0, [scan("first")]), guest(1, [scan("second")])],
    });
    mocks.fetchOrder.mockResolvedValue({ id: "order_existing", amount: 190000, currency: "INR", status: "created" });
    expect((await createBookingOrder(booking.id, "owner")).ok).toBe(false);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.db.booking.updateMany).not.toHaveBeenCalled();
  });

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
