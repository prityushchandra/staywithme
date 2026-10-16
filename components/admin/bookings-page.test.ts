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

beforeEach(() => {
  vi.clearAllMocks();
  db.listing.findMany.mockResolvedValue([listing]);
  db.offlineBooking.findMany.mockResolvedValue([]);
  db.booking.findMany.mockResolvedValue([]);
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
