import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminBookingsPage } from "./bookings-page";
import { GUEST_DOCUMENT_SELECT } from "@/lib/booking-documents";
import BookingsPage from "@/app/admin/bookings/page";
import { BOOKING_RECEIPT_MESSAGE } from "@/lib/receipt-share";

const db = vi.hoisted(() => ({
  booking: { findMany: vi.fn() },
  offlineBooking: { findMany: vi.fn() },
  listing: { findMany: vi.fn() },
  auth: vi.fn(),
  redirect: vi.fn(() => { throw new Error("redirect"); }),
  receipt: vi.fn(),
  review: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: db.auth }));
vi.mock("next/navigation", () => ({ redirect: db.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/settings", () => ({
  getPlatformSettings: vi.fn(async () => ({ upiId: "example@upi" })),
}));
vi.mock("@/components/admin/offline-booking-form", () => ({
  OfflineBookingForm: () => createElement("div", null, "Offline booking form"),
  OfflineBookingActions: () => null,
}));
vi.mock("@/components/admin/offline-booking-edit", () => ({ OfflineBookingEdit: () => null }));
vi.mock("@/components/admin/send-receipt-button", () => ({
  SendReceiptButton: (props: { receiptUrl: string; chatLink: string | null; message: string; fileName: string }) => {
    db.receipt(props);
    return createElement("button", null, "Send receipt");
  },
}));
vi.mock("@/components/admin/booking-actions", () => ({ BookingActions: () => null }));
vi.mock("@/components/admin/online-booking-review", () => ({
  OnlineBookingReview: ({ booking }: { booking: { guestName: string } }) => {
    db.review(booking);
    return createElement("div", null, `Approval request: ${booking.guestName}`);
  },
}));

const listing = {
  id: "flat-two", title: "Example stay", flatNumber: "908", block: "B",
  addressLine: "Example Residences", city: "Bengaluru", country: "India",
  lat: 12.9, lng: 77.6, mapsUrl: null,
  checkInTime: "3:30 PM", checkOutTime: "11:15 AM",
  wifiName: "Example_908", wifiPassword: "Example password",
};
const booking = {
  id: "guest-booking", listingId: listing.id, source: "ONLINE", status: "CONFIRMED",
  updatedAt: new Date("2026-11-01T12:00:00Z"),
  checkIn: new Date("2026-11-02T00:00:00Z"),
  checkOut: new Date("2026-11-05T00:00:00Z"),
  guests: 2, totalAmount: 1500000, amountPaid: 1500000,
  contactPhone: "+447700900123", publicToken: "example-token",
  guest: { name: "Account Full Name", firstName: "Maya", phone: "+919876543210" },
  listing,
  idDocs: [{
    id: "example-doc", position: null, name: "Maya", docName: "example-id.png", docSize: 100, documents: [],
  }],
};
const manualBooking = {
  id: "manual-booking", listingId: listing.id, guestName: "Manual Primary", guestPhone: "+919876543210",
  guests: 2, checkIn: new Date("2025-10-02T00:00:00Z"), checkOut: new Date("2025-10-05T00:00:00Z"),
  totalPrice: 900000, amountPaid: 900000, due: 0, source: "AIRBNB", status: "CONFIRMED", note: "Synthetic stay",
  publicToken: "manual-token", listing, updatedAt: new Date("2025-10-01T00:00:00Z"),
  guestDetails: [
    { id: "manual-doc", position: 0, name: "Manual Primary", docName: "manual-id.pdf", docSize: 100, documents: [] },
    { id: "manual-name", position: 1, name: "Manual Companion", docName: null, docSize: 0, documents: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  db.auth.mockResolvedValue({ user: { isAdmin: true } });
  vi.stubEnv("GUEST_ONBOARDING_DOOR_PIN", "1234567");
  db.listing.findMany.mockResolvedValue([listing]);
  db.offlineBooking.findMany.mockResolvedValue([]);
  db.booking.findMany.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("unified booking search", () => {
  it("labels dates and payment amounts separately for guest and manual booking details", async () => {
    db.booking.findMany.mockResolvedValue([{ ...booking, amountPaid: 1000000, reasonForVisit: "Work trip\nLate arrival" }]);
    db.offlineBooking.findMany.mockResolvedValue([manualBooking]);
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "search", searchParams: Promise.resolve({}) }));
    const cards = html.match(/<article[\s\S]*?<\/article>/g)!;
    const guest = cards.find((card) => card.includes('data-booking-kind="guest"'))!;
    const manual = cards.find((card) => card.includes('data-booking-kind="manual"'))!;
    expect(guest).toMatch(/>Guest<\/dt><dd[^>]*>Account Full Name<\/dd>/);
    expect(guest).toMatch(/>Check-in<\/dt><dd[^>]*>Nov 2, 2026, 3:30 PM<\/dd>/);
    expect(guest).toMatch(/>Check-out<\/dt><dd[^>]*>Nov 5, 2026, 11:15 AM<\/dd>/);
    expect(guest).toContain("<span>Total ₹15,000</span>");
    expect(guest).toContain("<span>Paid ₹10,000</span>");
    expect(guest).toContain("<span>Due ₹5,000</span>");
    expect(guest).toMatch(/>Phone<\/dt><dd[^>]*>\+447700900123<\/dd>/);
    expect(guest).toMatch(/>Reason<\/dt><dd[^>]*>Work trip\nLate arrival<\/dd>/);
    expect(manual).toMatch(/>Check-in<\/dt><dd[^>]*>Oct 2, 2025, 3:30 PM<\/dd>/);
    expect(manual).toMatch(/>Check-out<\/dt><dd[^>]*>Oct 5, 2025, 11:15 AM<\/dd>/);
    expect(manual).toContain("<span>Total ₹9,000</span>");
    expect(manual).toContain("<span>Paid ₹9,000</span>");
  });

  it.each([null, { user: { isAdmin: false } }])("requires admin access before searching guest data", async (session) => {
    db.auth.mockResolvedValue(session);
    await expect(AdminBookingsPage({ kind: "search", searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.offlineBooking.findMany).not.toHaveBeenCalled();
    expect(db.listing.findMany).not.toHaveBeenCalled();
  });

  it("merges guest and manual stays chronologically with every supplied guest and ID", async () => {
    db.offlineBooking.findMany.mockResolvedValue([manualBooking]);
    db.booking.findMany.mockResolvedValue([{
      ...booking, checkIn: new Date("2025-10-10T00:00:00Z"), checkOut: new Date("2025-10-12T00:00:00Z"),
    }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "search", searchParams: Promise.resolve({ view: "past" }),
    }));
    expect(html).toContain("Booking search");
    expect(html).not.toContain("Record a booking");
    expect(html).toContain("Manual Companion");
    expect(html).toContain("View Manual Primary&#x27;s attachment");
    expect(html).toContain("View Maya&#x27;s attachment");
    expect(html).toContain("No Aadhaar / ID uploaded.");
    expect(html.indexOf('data-booking-kind="guest"')).toBeLessThan(html.indexOf('data-booking-kind="manual"'));
    expect(html).toContain('<option value="past" selected="">Past stays</option>');
    const onboarding = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)]
      .map((match) => new URL(match[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'")))
      .filter((url) => url.searchParams.get("text")?.startsWith("Flat: "));
    expect(onboarding.map((url) => url.pathname)).toEqual(["/447700900123", "/919876543210"]);
    for (const url of onboarding) {
      expect(url.searchParams.get("text")).toContain("Flat: 908, B tower\n\nssid: Airtel_908");
      expect(url.searchParams.get("text")).toContain("door pin: 1234567");
    }
    expect(db.booking.findMany).toHaveBeenCalledTimes(2);
    expect(db.booking.findMany).toHaveBeenNthCalledWith(1, {
      where: { checkOut: { lte: new Date("2026-11-15T00:00:00Z") }, NOT: { source: "ONLINE", status: "PENDING" } },
      select: { id: true, checkIn: true, checkOut: true },
    });
    expect(db.booking.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { AND: [
        { checkOut: { lte: new Date("2026-11-15T00:00:00Z") }, NOT: { source: "ONLINE", status: "PENDING" } },
        { id: { in: [booking.id] } },
      ] },
    }));
    const manualQuery = db.offlineBooking.findMany.mock.calls[1][0];
    expect(manualQuery.include.guestDetails.select.docData).toBeUndefined();
    expect(manualQuery.include.guestDetails.select.docName).toBe(true);
    expect(manualQuery.include.guestDetails.select.documents.select.docData).toBeUndefined();
  });

  it("groups every attachment by guest without counting two files as two guests", async () => {
    const child = { id: "extra-doc", docName: "back-of-id.pdf", docSize: 100 };
    db.offlineBooking.findMany.mockResolvedValue([{
      ...manualBooking, guestDetails: [
        { ...manualBooking.guestDetails[0], documents: [child] },
        manualBooking.guestDetails[1],
      ],
    }]);
    db.booking.findMany.mockResolvedValue([{
      ...booking, idDocs: [{ ...booking.idDocs[0], documents: [{ ...child, id: "online-extra" }] }],
    }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "search", searchParams: Promise.resolve({ view: "past" }),
    }));
    expect(html).toContain("View Manual Primary&#x27;s attachment: back-of-id.pdf");
    expect(html).toContain("View Maya&#x27;s attachment: back-of-id.pdf");
    expect(html.match(/1 \/ 2 guests with IDs/g)).toHaveLength(2);
    expect(html).toContain("example-id.png");
    expect(html).toContain("manual-id.pdf");
  });

  it("applies the same flat, overlap and status filters to both booking sources", async () => {
    const params = { view: "past", status: "CANCELLED", from: "2025-10-01", to: "2025-10-31", flat: listing.id };
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "search", searchParams: Promise.resolve(params) }));
    const shared = {
      listingId: listing.id, status: "CANCELLED",
      checkIn: { lt: new Date("2025-11-01T00:00:00Z") },
      checkOut: { gt: new Date("2025-10-01T00:00:00Z"), lte: new Date("2026-11-15T00:00:00Z") },
    };
    expect(db.offlineBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: shared }));
    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...shared, NOT: { source: "ONLINE", status: "PENDING" } },
    }));
    expect(html).toContain('href="/admin/booking-search"');
    expect(html).toContain('action="/admin/booking-search"');
    expect(html).toContain("No bookings match these filters.");
  });

  it.each(["GUEST", "MANUAL"])("can filter history to %s without querying the other source", async (source) => {
    await AdminBookingsPage({ kind: "search", searchParams: Promise.resolve({ view: "past", source }) });
    expect(db.booking.findMany).toHaveBeenCalledTimes(source === "GUEST" ? 1 : 0);
    expect(db.offlineBooking.findMany).toHaveBeenCalledTimes(source === "MANUAL" ? 1 : 0);
  });

  it("searches primary and companion names case-insensitively in both sources", async () => {
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "search", searchParams: Promise.resolve({ guest: "  maYa  ", flat: listing.id, view: "upcoming" }),
    }));
    const name = { contains: "maYa", mode: "insensitive" };
    const common = { listingId: listing.id, checkOut: { gt: new Date("2026-11-15T00:00:00Z") } };
    expect(db.booking.findMany).toHaveBeenCalledWith({
      select: { id: true, checkIn: true, checkOut: true },
      where: {
        ...common, NOT: { source: "ONLINE", status: "PENDING" },
        OR: [{ guest: { name } }, { guest: { firstName: name } }, { idDocs: { some: { name } } }],
      },
    });
    expect(db.offlineBooking.findMany).toHaveBeenCalledWith({
      select: { id: true, checkIn: true, checkOut: true },
      where: { ...common, OR: [{ guestName: name }, { guestDetails: { some: { name } } }] },
    });
    expect(html).toContain('name="guest"');
    expect(html).toContain('value="maYa"');
  });

  it.each([
    { from: "2026-02-31" },
    { from: "2026-11-20", to: "2026-11-01" },
    { guest: "a".repeat(121) },
  ])("reports invalid filters without loading a misleading unfiltered result", async (params) => {
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "search", searchParams: Promise.resolve(params) }));
    expect(html).toContain('role="alert"');
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.offlineBooking.findMany).not.toHaveBeenCalled();
    expect(html).not.toContain("No bookings match");
  });

  it("uses the India calendar date and includes an in-progress stay in upcoming results", async () => {
    vi.setSystemTime(new Date("2026-11-14T19:00:00Z"));
    db.offlineBooking.findMany.mockResolvedValue([{
      ...manualBooking, checkIn: new Date("2026-11-13T00:00:00Z"), checkOut: new Date("2026-11-16T00:00:00Z"),
    }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "search", searchParams: Promise.resolve({ view: "upcoming", source: "MANUAL", from: "2026-11-14" }),
    }));
    expect(db.offlineBooking.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { checkOut: { gt: new Date("2026-11-15T00:00:00Z") } },
    }));
    expect(html).toContain("Manual Primary");
  });

  it("pages the merged sources without gaps and loads details only for the selected page", async () => {
    const manual = Array.from({ length: 21 }, (_, index) => ({
      ...manualBooking, id: `manual-${index}`,
      checkIn: new Date(Date.UTC(2026, 10, 16 + index * 2)), checkOut: new Date(Date.UTC(2026, 10, 17 + index * 2)),
    }));
    const guests = Array.from({ length: 21 }, (_, index) => ({
      ...booking, id: `guest-${index}`,
      checkIn: new Date(Date.UTC(2026, 10, 17 + index * 2)), checkOut: new Date(Date.UTC(2026, 10, 18 + index * 2)),
    }));
    type Query = { select?: unknown; where: { AND?: { id?: { in: string[] } }[] } };
    db.offlineBooking.findMany.mockImplementation(async ({ select, where }: Query) => select ? manual
      : manual.filter((row) => where.AND?.some((part) => part.id?.in.includes(row.id))));
    db.booking.findMany.mockImplementation(async ({ select, where }: Query) => select ? guests
      : guests.filter((row) => where.AND?.some((part) => part.id?.in.includes(row.id))));
    const pages = [];
    for (const page of ["1", "2", "3"]) {
      pages.push(renderToStaticMarkup(await AdminBookingsPage({
        kind: "search", searchParams: Promise.resolve({ page, flat: listing.id, from: "2026-11-01", to: "2027-01-31" }),
      })));
    }
    expect(pages.map((html) => (html.match(/data-booking-kind=/g) ?? []).length)).toEqual([20, 20, 2]);
    expect(pages[0]).toContain("Bookings (42)");
    expect(pages[0]).toContain("from=2026-11-01&amp;to=2027-01-31&amp;flat=flat-two&amp;page=2");
    const loadedGuestIds = db.booking.findMany.mock.calls.filter(([query]) => query.include)
      .flatMap(([query]) => query.where.AND[1].id.in);
    const loadedManualIds = db.offlineBooking.findMany.mock.calls.filter(([query]) => query.include)
      .flatMap(([query]) => query.where.AND[1].id.in);
    expect(loadedGuestIds).toEqual(guests.map((row) => row.id));
    expect(loadedManualIds).toEqual(manual.map((row) => row.id));
  });

  it("puts current and upcoming stays before completed stays across both sources", async () => {
    db.offlineBooking.findMany.mockResolvedValue([manualBooking, {
      ...manualBooking, id: "future-manual", guestName: "Future Manual",
      checkIn: new Date("2026-11-25T00:00:00Z"), checkOut: new Date("2026-11-27T00:00:00Z"),
    }]);
    db.booking.findMany.mockResolvedValue([booking, {
      ...booking, id: "current-guest", guest: { ...booking.guest, name: "Current Guest" },
      checkIn: new Date("2026-11-13T00:00:00Z"), checkOut: new Date("2026-11-17T00:00:00Z"),
    }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "search", searchParams: Promise.resolve({}) }));
    const articles = html.match(/<article[\s\S]*?<\/article>/g)!;
    expect(articles).toHaveLength(4);
    expect(articles[0]).toContain("Current Guest");
    expect(articles[1]).toContain("Future Manual");
    expect(articles[2]).toContain("Account Full Name");
    expect(articles[3]).toContain("Manual Primary");
    expect(db.booking.findMany.mock.calls[0][0].where.checkOut).toBeUndefined();
  });
});

describe("paid booking review details", () => {
  it("shows the account phone when the booking has no separate contact phone", async () => {
    const { OnlineBookingReview } = await vi.importActual<typeof import("./online-booking-review")>("./online-booking-review");
    const html = renderToStaticMarkup(createElement(OnlineBookingReview, {
      booking: {
        id: "review-example", listingTitle: "Example stay", guestName: "Example Guest",
        guestPhone: "+919876543210", contactPhone: null,
        checkIn: "Nov 2, 2026", checkOut: "Nov 5, 2026", checkInTime: "3:30 PM", checkOutTime: "11:15 AM",
        nights: 3, guests: 1, totalAmount: 1500000, amountPaid: 1500000,
        reasonForVisit: "Work trip", adminNote: null, paidAt: null, razorpayPaymentId: "pay_example",
        docs: [], receiptUrl: "/api/receipts/booking/review-example", receiptFileName: "booking_receipt_example.pdf",
      },
    }));
    expect(html).toMatch(/>Phone<\/dt><dd[^>]*>\+919876543210<\/dd>/);
    expect(html).toContain('href="tel:+919876543210"');
    expect(html).toContain("pay_example");
    expect(html).toContain("Work trip");
  });
});

describe("separate admin booking tabs", () => {
  it("uses Bookings only for manual entry, without fetching either booking history", async () => {
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "offline",
      searchParams: Promise.resolve({ status: "CANCELLED", from: "2026-11-01", flat: listing.id }),
    }));
    expect(html).toContain("Record a booking");
    expect(html).toContain("Offline booking form");
    expect(html).toContain('href="/admin/booking-search?source=MANUAL"');
    expect(html).not.toContain("Booking history");
    expect(html).not.toContain('name="status"');
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.offlineBooking.findMany).not.toHaveBeenCalled();
    expect(html).not.toContain('name="flat"');
  });

  it("keeps old past-booking links working on the dedicated search route", async () => {
    await expect(BookingsPage({
      searchParams: Promise.resolve({ view: "past", source: "GUEST", flat: listing.id, guest: "Maya" }),
    })).rejects.toThrow("redirect");
    expect(db.redirect).toHaveBeenCalledWith("/admin/booking-search?view=past&flat=flat-two&source=GUEST&guest=Maya");
  });

  it("applies guest filters on the new route while keeping paid approval requests visible", async () => {
    const pending = {
      ...booking, id: "paid-request", status: "AWAITING_APPROVAL",
      guest: { name: "Waiting Guest", firstName: "Waiting", phone: "+919876543210" },
      paidAt: new Date("2026-10-16T10:00:00Z"),
      reasonForVisit: "Holiday", adminNote: null, razorpayPaymentId: "example-payment",
    };
    db.booking.findMany.mockResolvedValueOnce([booking]).mockResolvedValueOnce([pending]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "guest",
      searchParams: Promise.resolve({
        status: "CONFIRMED", flat: listing.id, from: "2026-11-01", to: "2026-11-30",
      }),
    }));
    expect(html).toContain("Guest bookings");
    expect(html).toContain("Approval request: Waiting Guest");
    expect(db.review).toHaveBeenCalledWith(expect.objectContaining({
      receiptUrl: "/api/receipts/booking/paid-request?t=example-token",
      receiptFileName: "booking_receipt_waiting_guest_2026-11-02.pdf",
    }));
    expect(html).toContain('action="/admin/guest-bookings"');
    expect(html).toContain('/admin/guest-bookings?status=CANCELLED&amp;from=2026-11-01&amp;to=2026-11-30&amp;flat=flat-two');
    expect(html).not.toContain("Record a booking");
    expect(html).not.toContain("Offline booking form");
    expect(db.offlineBooking.findMany).not.toHaveBeenCalled();
    expect(db.booking.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        status: "CONFIRMED",
        listingId: listing.id,
        checkIn: { lt: new Date("2026-12-01T00:00:00Z") },
        checkOut: { gt: new Date("2026-11-01T00:00:00Z") },
        NOT: { source: "ONLINE", status: "PENDING" },
      },
      include: expect.objectContaining({
        idDocs: { select: GUEST_DOCUMENT_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      }),
    }));
    expect(db.booking.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: "AWAITING_APPROVAL", source: "ONLINE" },
    }));
    expect(html).toContain("View Maya&#x27;s attachment");
    const welcomeLink = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)]
      .map((match) => new URL(match[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'")))
      .find((url) => url.searchParams.get("text")?.startsWith("Flat: "));
    expect(welcomeLink?.pathname).toBe("/447700900123");
    expect(welcomeLink?.searchParams.get("text")).toContain("Flat: 908, B tower\n\nssid: Airtel_908");
  });

  it("retains both paid-online history and legacy WhatsApp guest requests", async () => {
    db.booking.findMany.mockResolvedValueOnce([
      booking,
      {
        ...booking, id: "legacy-request", source: "WHATSAPP", status: "PENDING", amountPaid: 0, idDocs: [],
        guest: { name: "Legacy Guest", firstName: "Legacy", phone: "+919876543210" },
      },
    ]).mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "guest", searchParams: Promise.resolve({}),
    }));
    expect(html).toContain("Account Full Name");
    expect(html).toContain("Legacy Guest");
    expect(html.match(/ Onboard<\/a>/g)).toHaveLength(1);
    expect(db.booking.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { NOT: { source: "ONLINE", status: "PENDING" } },
    }));
    expect(db.receipt).toHaveBeenCalledOnce();
    expect(db.receipt).toHaveBeenCalledWith({
      receiptUrl: "/api/receipts/booking/guest-booking?t=example-token",
      chatLink: `https://wa.me/447700900123?text=${encodeURIComponent(BOOKING_RECEIPT_MESSAGE)}`,
      message: BOOKING_RECEIPT_MESSAGE,
      fileName: "booking_receipt_account_full_name_2026-11-02.pdf",
    });
    expect(html).toContain("Send receipt");
    expect(html).toContain("Download receipt");
  });

  it("can prepare a paid guest receipt with admin authentication when no public token exists", async () => {
    db.booking.findMany.mockResolvedValueOnce([{ ...booking, publicToken: null }]).mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "guest", searchParams: Promise.resolve({}) }));
    expect(db.receipt).toHaveBeenCalledWith(expect.objectContaining({ receiptUrl: "/api/receipts/booking/guest-booking" }));
    expect(html).toContain('/api/receipts/booking/guest-booking?download=1');
  });
});
