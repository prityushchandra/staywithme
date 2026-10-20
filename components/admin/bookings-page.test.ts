import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminBookingsPage } from "./bookings-page";

const db = vi.hoisted(() => ({
  booking: { findMany: vi.fn() },
  offlineBooking: { findMany: vi.fn() },
  listing: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/settings", () => ({
  getPlatformSettings: vi.fn(async () => ({ upiId: "example@upi" })),
}));
vi.mock("@/components/admin/offline-booking-form", () => ({
  OfflineBookingForm: () => createElement("div", null, "Offline booking form"),
  OfflineBookingActions: () => null,
}));
vi.mock("@/components/admin/offline-booking-edit", () => ({ OfflineBookingEdit: () => null }));
vi.mock("@/components/admin/send-receipt-button", () => ({ SendReceiptButton: () => null }));
vi.mock("@/components/admin/booking-actions", () => ({ BookingActions: () => null }));
vi.mock("@/components/admin/online-booking-review", () => ({
  OnlineBookingReview: ({ booking }: { booking: { guestName: string } }) =>
    createElement("div", null, `Approval request: ${booking.guestName}`),
}));

const listing = {
  id: "flat-two", title: "Example stay", flatNumber: "908", block: "B",
  addressLine: "Example Residences", city: "Bengaluru", country: "India",
  lat: 12.9, lng: 77.6, mapsUrl: null,
  checkInTime: "3:30 PM", checkOutTime: "11:15 AM",
  wifiName: "Example_908", wifiPassword: "Example password",
};
const booking = {
  id: "guest-booking", source: "ONLINE", status: "CONFIRMED",
  checkIn: new Date("2026-11-02T00:00:00Z"),
  checkOut: new Date("2026-11-05T00:00:00Z"),
  guests: 2, totalAmount: 1500000, amountPaid: 1500000,
  contactPhone: "+447700900123", publicToken: "example-token",
  guest: { name: "Account Full Name", firstName: "Maya", phone: "+919876543210" },
  listing,
  idDocs: [{ id: "example-doc", name: "Maya", docName: "example-id.png" }],
};
const manualBooking = {
  id: "manual-booking", listingId: listing.id, guestName: "Manual Primary", guestPhone: "+919876543210",
  guests: 2, checkIn: new Date("2025-10-02T00:00:00Z"), checkOut: new Date("2025-10-05T00:00:00Z"),
  totalPrice: 900000, amountPaid: 900000, due: 0, source: "AIRBNB", status: "CONFIRMED", note: "Synthetic stay",
  publicToken: "manual-token", listing,
  guestDetails: [
    { id: "manual-doc", position: 0, name: "Manual Primary", docName: "manual-id.pdf", docSize: 100 },
    { id: "manual-name", position: 1, name: "Manual Companion", docName: null, docSize: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listing.findMany.mockResolvedValue([listing]);
  db.offlineBooking.findMany.mockResolvedValue([]);
  db.booking.findMany.mockResolvedValue([]);
});

describe("combined past booking history", () => {
  it("merges guest and manual stays chronologically with every supplied guest and ID", async () => {
    db.offlineBooking.findMany.mockResolvedValue([manualBooking]);
    db.booking.findMany.mockResolvedValue([{
      ...booking, checkIn: new Date("2025-10-10T00:00:00Z"), checkOut: new Date("2025-10-12T00:00:00Z"),
    }]);
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "offline", searchParams: Promise.resolve({ view: "past" }),
    }));
    expect(html).toContain("Guest + manual booking history");
    expect(html).not.toContain("Record a booking");
    expect(html).toContain("Manual Companion");
    expect(html).toContain("View Manual Primary&#x27;s attachment");
    expect(html).toContain("View Maya&#x27;s attachment");
    expect(html).toContain("No Aadhaar / ID uploaded.");
    expect(html.indexOf('data-booking-kind="guest"')).toBeLessThan(html.indexOf('data-booking-kind="manual"'));
    expect(html).toContain('name="view" value="past"');
    expect(db.booking.findMany).toHaveBeenCalledOnce();
    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { checkOut: { lt: expect.any(Date) }, NOT: { source: "ONLINE", status: "PENDING" } },
      orderBy: [{ checkOut: "desc" }, { checkIn: "desc" }],
    }));
    const manualQuery = db.offlineBooking.findMany.mock.calls[0][0];
    expect(manualQuery.include.guestDetails.select.docData).toBeUndefined();
    expect(manualQuery.include.guestDetails.select.docName).toBe(true);
  });

  it("applies the same flat, overlap and status filters to both booking sources", async () => {
    const params = { view: "past", status: "CANCELLED", from: "2025-10-01", to: "2025-10-31", flat: listing.id };
    const html = renderToStaticMarkup(await AdminBookingsPage({ kind: "offline", searchParams: Promise.resolve(params) }));
    const shared = {
      listingId: listing.id, status: "CANCELLED",
      checkIn: { lt: new Date("2025-11-01T00:00:00Z") },
      checkOut: { gt: new Date("2025-10-01T00:00:00Z"), lt: expect.any(Date) },
    };
    expect(db.offlineBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: shared }));
    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...shared, NOT: { source: "ONLINE", status: "PENDING" } },
    }));
    expect(html).toContain('href="/admin/bookings?view=past"');
    expect(html).toContain('action="/admin/bookings"');
    expect(html).toContain("No past bookings match these filters.");
  });

  it.each(["GUEST", "MANUAL"])("can filter history to %s without querying the other source", async (source) => {
    await AdminBookingsPage({ kind: "offline", searchParams: Promise.resolve({ view: "past", source }) });
    expect(db.booking.findMany).toHaveBeenCalledTimes(source === "GUEST" ? 1 : 0);
    expect(db.offlineBooking.findMany).toHaveBeenCalledTimes(source === "MANUAL" ? 1 : 0);
  });
});

describe("separate admin booking tabs", () => {
  it("keeps offline creation and filters in Bookings without fetching guest bookings or documents", async () => {
    const html = renderToStaticMarkup(await AdminBookingsPage({
      kind: "offline",
      searchParams: Promise.resolve({ status: "CANCELLED", from: "2026-11-01", flat: listing.id }),
    }));
    expect(html).toContain("Record a booking");
    expect(html).toContain("Offline booking form");
    expect(html).toContain('action="/admin/bookings"');
    expect(html).not.toContain("Booking history");
    expect(html).not.toContain('name="status"');
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.offlineBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        listingId: listing.id,
        checkOut: { gt: new Date("2026-11-01T00:00:00Z") },
      },
    }));
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
        idDocs: { select: { id: true, name: true, docName: true }, orderBy: { createdAt: "asc" } },
      }),
    }));
    expect(db.booking.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: "AWAITING_APPROVAL", source: "ONLINE" },
    }));
    expect(html).toContain("View Maya&#x27;s attachment");
    const welcomeLink = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)]
      .map((match) => new URL(match[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'")))
      .find((url) => url.searchParams.get("text")?.includes("super excited"));
    expect(welcomeLink?.pathname).toBe("/447700900123");
    expect(welcomeLink?.searchParams.get("text")).toMatch(/^Hi Maya,/);
  });

  it("retains both paid-online history and legacy WhatsApp guest requests", async () => {
    db.booking.findMany.mockResolvedValueOnce([
      booking,
      {
        ...booking, id: "legacy-request", source: "WHATSAPP", status: "PENDING", idDocs: [],
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
  });
});
