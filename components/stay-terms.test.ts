import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StayTerms } from "./stay-terms";
import { PricingBreakdown } from "./pricing-breakdown";
import { ListingCard } from "./listing-card";
import { DateRangePicker } from "./date-range-picker";
import { InquiryPanel } from "./inquiry-panel";
import { MobileBookingBar } from "./mobile-booking-bar";
import { ListingForm } from "./listing-form";
import type { ReserveCta, LiveListingData } from "./booking-context";

const mocks = vi.hoisted(() => ({
  booking: vi.fn(), searchDates: vi.fn(),
}));
vi.mock("./booking-context", () => ({ useBooking: mocks.booking }));
vi.mock("./search-dates-context", () => ({ useSearchDates: mocks.searchDates }));
vi.mock("./wishlist-button", () => ({ WishlistButton: () => null }));
vi.mock("./image-uploader", () => ({ ImageUploader: () => null }));
vi.mock("./reserve-button", () => ({
  ReserveButton: ({ cta }: { cta: ReserveCta }) => createElement("button", { "data-kind": cta.kind }, cta.label),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { isAdmin: true } }, update: vi.fn() }) }));

const listing = {
  id: "synthetic", title: "Synthetic monthly stay", cover: null,
  basePrice: 200000, discountedPrice: 150000, monthlyPrice: 3000000,
  minimumNights: 30, monthlyStayDiscount: 500000,
};
const panelProps = {
  propertyId: listing.id, propertyName: listing.title, ...listing,
  platformFeePercent: 10, maxGuests: 2, whatsappNumber: "", isAuthenticated: true,
};
const bookingState = {
  checkIn: "2027-03-01", checkOut: "2027-03-31", guests: 1, infants: 0,
  minimumNights: 30, monthlyStayDiscount: 500000, liveListing: null as LiveListingData | null,
  isCompactLayout: false, pickerOpen: false,
  setRange: vi.fn(), setGuests: vi.fn(), setInfants: vi.fn(), setPickerOpen: vi.fn(), setReserveCta: vi.fn(),
  reserveCta: { kind: "incomplete", label: "Reserve", shortLabel: "Reserve", missing: [] } satisfies ReserveCta,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.booking.mockReturnValue({ ...bookingState });
  mocks.searchDates.mockReturnValue(null);
});

describe("guest-facing stay terms", () => {
  it("advertises the fixed total discount and its minimum before dates, without changing unrestricted cards", () => {
    const html = renderToStaticMarkup(createElement(ListingCard, { listing, platformFeePercent: 10 }));
    expect(html).toContain("Monthly stays discount");
    expect(html).toContain("₹5,000");
    expect(html).toContain("Minimum 30 nights");
    expect(html).not.toContain("for 1 night");
    expect(renderToStaticMarkup(createElement(StayTerms, {}))).toBe("");
    const unrestricted = renderToStaticMarkup(createElement(ListingCard, {
      listing: { ...listing, minimumNights: null, monthlyStayDiscount: null }, platformFeePercent: 10,
    }));
    expect(unrestricted).not.toContain("Monthly stays discount");
    expect(unrestricted).toContain("for 1 night");
  });

  it("uses the same discounted total on search cards, the breakdown and the mobile bar", () => {
    mocks.searchDates.mockReturnValue({ checkIn: "2027-03-01", checkOut: "2027-03-31", query: "" });
    mocks.booking.mockReturnValue({ ...bookingState, isCompactLayout: true });
    const outputs = [
      renderToStaticMarkup(createElement(ListingCard, { listing, platformFeePercent: 10 })),
      renderToStaticMarkup(createElement(PricingBreakdown, { ...listing, basePrice: 150000, nights: 30, platformFeePercent: 10 })),
      renderToStaticMarkup(createElement(MobileBookingBar, { ...listing, platformFeePercent: 10 })),
    ];
    for (const html of outputs) expect(html).toContain("₹28,000");
    expect(outputs[1]).toContain("−₹5,000");
  });

  it("withholds the total and booking action for URL dates below the minimum", () => {
    mocks.booking.mockReturnValue({ ...bookingState, checkOut: "2027-03-03" });
    const html = renderToStaticMarkup(createElement(InquiryPanel, panelProps));
    expect(html).toContain('data-kind="minimum-stay"');
    expect(html).toContain("Choose a longer stay to see your total");
    expect(html).not.toContain(">Total<");

    mocks.booking.mockReturnValue({ ...bookingState, checkOut: "2027-03-03", isCompactLayout: true });
    const mobile = renderToStaticMarkup(createElement(MobileBookingBar, { ...listing, platformFeePercent: 10 }));
    expect(mobile).toContain("Minimum 30 nights");
    expect(mobile).not.toContain(">total<");
  });

  it("shows the exact-minimum total and refreshes the rule after a live quote changes it", () => {
    expect(renderToStaticMarkup(createElement(InquiryPanel, panelProps))).toContain("₹28,000");
    mocks.booking.mockReturnValue({
      ...bookingState, minimumNights: 31,
      liveListing: { ...listing, minimumNights: 31, platformFeePercent: 10, blockedRanges: [] },
    });
    const html = renderToStaticMarkup(createElement(InquiryPanel, panelProps));
    expect(html).toContain("Minimum 31 nights");
    expect(html).not.toContain("₹28,000");
  });

  it("shows the rule inside the calendar and disables too-early checkouts", () => {
    const html = renderToStaticMarkup(createElement(DateRangePicker, {
      checkIn: "2027-03-01", checkOut: "", onChange: vi.fn(), open: true,
      minimumNights: 30, monthlyStayDiscount: 500000, allowPast: true,
    }));
    expect(html).toContain("Monthly stays discount");
    const early = html.match(/<button\b[^>]*aria-label="[^"]*March 2, 2027[^"]*"[^>]*>/)?.[0];
    const valid = html.match(/<button\b[^>]*aria-label="[^"]*March 31, 2027[^"]*"[^>]*>/)?.[0];
    expect(early).toContain('disabled=""');
    expect(early).toContain("Minimum 30 nights");
    expect(valid).toBeTruthy();
    expect(valid).not.toContain("disabled");
  });

  it("restores saved terms into editor controls, and leaves the offer disabled without a minimum", () => {
    const props = { amenities: [], blocks: [], policies: [], suggestedMinPaise: 100000, suggestedMaxPaise: 200000 };
    const html = renderToStaticMarkup(createElement(ListingForm, {
      ...props, listingId: "synthetic",
      initial: {
        title: listing.title, description: "Synthetic editor test content.", hostDisplayName: "",
        propertyType: "APARTMENT", roomType: "ENTIRE", addressLine: "Test", city: "Test", country: "India",
        flatNumber: "T1234", block: "Test", bedrooms: 1, bathrooms: 1, beds: 1, maxGuests: 2,
        basePriceRupees: 2000, cancellationPolicy: "FLEXIBLE", amenityKeys: [], imageUrls: [],
        minimumNights: 30, monthlyStayDiscountRupees: 5000,
      },
    }));
    expect(html.match(/<input\b[^>]*id="minimumNights"[^>]*>/)?.[0]).toContain('value="30"');
    expect(html.match(/<input\b[^>]*id="monthlyStayDiscount"[^>]*>/)?.[0]).toContain('value="5000"');
    const empty = renderToStaticMarkup(createElement(ListingForm, props));
    expect(empty.match(/<input\b[^>]*id="monthlyStayDiscount"[^>]*>/)?.[0]).toContain('disabled=""');
  });
});
