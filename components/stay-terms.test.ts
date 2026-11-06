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
import { getMonthlyStayOffer } from "@/lib/pricing";

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
  minimumNights: 30, monthlyStayDiscount: null,
};
const monthlyOffer = getMonthlyStayOffer(listing, { platformFeePercent: 10 });
const panelProps = {
  propertyId: listing.id, propertyName: listing.title, ...listing,
  platformFeePercent: 10, maxGuests: 2, whatsappNumber: "", isAuthenticated: true,
};
const bookingState = {
  checkIn: "2027-03-01", checkOut: "2027-03-31", guests: 1, infants: 0,
  minimumNights: 30, monthlyStayDiscount: null, liveListing: null as LiveListingData | null,
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
  it("advertises calculated monthly savings and the 30-night price before dates, while preserving nightly-only cards", () => {
    const html = renderToStaticMarkup(createElement(ListingCard, { listing, platformFeePercent: 10 }));
    expect(html).toContain("Monthly stays discount");
    expect(html).toContain("50% off monthly stays");
    expect(html).toContain("₹33,000");
    expect(html).toContain("₹66,000");
    expect(html).toContain("Minimum 30 nights");
    expect(html).not.toContain("for 1 night");
    expect(renderToStaticMarkup(createElement(StayTerms, {}))).toBe("");
    const unrestricted = renderToStaticMarkup(createElement(ListingCard, {
      listing: { ...listing, monthlyPrice: null, minimumNights: null, monthlyStayDiscount: null }, platformFeePercent: 10,
    }));
    expect(unrestricted).not.toContain("Monthly stays discount");
    expect(unrestricted).toContain("for 1 night");
  });

  it("shows the same 44-night total and crossed-out base nightly total on every booking surface", () => {
    mocks.searchDates.mockReturnValue({ checkIn: "2027-03-01", checkOut: "2027-04-14", query: "" });
    mocks.booking.mockReturnValue({ ...bookingState, checkOut: "2027-04-14", isCompactLayout: true });
    const outputs = [
      renderToStaticMarkup(createElement(ListingCard, { listing, platformFeePercent: 10 })),
      renderToStaticMarkup(createElement(PricingBreakdown, { ...listing, basePrice: 150000, listPrice: 200000, nights: 44, platformFeePercent: 10 })),
      renderToStaticMarkup(createElement(MobileBookingBar, { ...listing, platformFeePercent: 10 })),
      renderToStaticMarkup(createElement(InquiryPanel, panelProps)),
    ];
    for (const html of outputs) {
      expect(html).toContain("₹48,400");
      expect(html).toMatch(/<span[^>]*class="[^"]*line-through[^"]*"[^>]*>₹96,800<\/span>/);
    }
    expect(outputs[1]).toContain("₹30,000 ÷ 30");
    expect(outputs[1]).toContain("44 nights");
    expect(outputs[1]).not.toContain("−₹48,400");
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
    expect(renderToStaticMarkup(createElement(InquiryPanel, panelProps))).toContain(">Total<");
    mocks.booking.mockReturnValue({
      ...bookingState, minimumNights: 31,
      liveListing: { ...listing, minimumNights: 31, platformFeePercent: 10, blockedRanges: [] },
    });
    const html = renderToStaticMarkup(createElement(InquiryPanel, panelProps));
    expect(html).toContain("Minimum 31 nights");
    expect(html).not.toContain(">Total<");
    expect(html).toContain('data-kind="minimum-stay"');
  });

  it("refreshes the monthly amount and removes savings when the fresh rate is no longer discounted", () => {
    mocks.booking.mockReturnValue({
      ...bookingState, checkOut: "2027-04-14",
      liveListing: { ...listing, monthlyPrice: 6000000, platformFeePercent: 10, blockedRanges: [] },
    });
    const html = renderToStaticMarkup(createElement(InquiryPanel, panelProps));
    expect(html).toContain("₹96,800");
    expect(html).not.toContain("Monthly stays discount");
    expect(html).not.toContain("You save");
    expect(html).not.toContain("line-through");
  });

  it("does not reinterpret a legacy fixed discount as a new monthly amount", () => {
    const html = renderToStaticMarkup(createElement(PricingBreakdown, {
      ...listing, basePrice: 150000, listPrice: 200000, monthlyStayDiscount: 500000, nights: 30, platformFeePercent: 10,
    }));
    expect(html).toContain("₹28,000");
    expect(html).toContain("−₹5,000");
    const legacy = renderToStaticMarkup(createElement(StayTerms, { minimumNights: 30, monthlyStayDiscount: 500000 }));
    expect(legacy).toContain("Applied once per booking");
    expect(legacy).toContain("₹5,000");
  });

  it("shows the rule inside the calendar and disables too-early checkouts", () => {
    const html = renderToStaticMarkup(createElement(DateRangePicker, {
      checkIn: "2027-03-01", checkOut: "", onChange: vi.fn(), open: true,
      minimumNights: 30, monthlyOffer, allowPast: true,
    }));
    expect(html).toContain("Monthly stays discount");
    const early = html.match(/<button\b[^>]*aria-label="[^"]*March 2, 2027[^"]*"[^>]*>/)?.[0];
    const valid = html.match(/<button\b[^>]*aria-label="[^"]*March 31, 2027[^"]*"[^>]*>/)?.[0];
    expect(early).toContain('disabled=""');
    expect(early).toContain("Minimum 30 nights");
    expect(valid).toBeTruthy();
    expect(valid).not.toContain("disabled");
  });

  it("restores the 30-night amount, previews prorated savings, and does not require entering a discount", () => {
    const props = { amenities: [], blocks: [], policies: [], suggestedMinPaise: 100000, suggestedMaxPaise: 200000, platformFeePercent: 10 };
    const html = renderToStaticMarkup(createElement(ListingForm, {
      ...props, listingId: "synthetic",
      initial: {
        title: listing.title, description: "Synthetic editor test content.", hostDisplayName: "",
        propertyType: "APARTMENT", roomType: "ENTIRE", addressLine: "Test", city: "Test", country: "India",
        flatNumber: "T1234", block: "Test", bedrooms: 1, bathrooms: 1, beds: 1, maxGuests: 2,
        basePriceRupees: 2000, cancellationPolicy: "FLEXIBLE", amenityKeys: [], imageUrls: [],
        minimumNights: 30, monthlyPriceRupees: 30000,
      },
    }));
    expect(html.match(/<input\b[^>]*id="minimumNights"[^>]*>/)?.[0]).toContain('value="30"');
    expect(html.match(/<input\b[^>]*id="monthlyPrice"[^>]*>/)?.[0]).toContain('value="30000"');
    expect(html).not.toContain('id="monthlyStayDiscount"');
    expect(html).toContain("₹33,000");
    expect(html).toContain("₹48,400");
    expect(html).toContain("50% off");
    expect(html).toContain("10% Platform Fee");
    const empty = renderToStaticMarkup(createElement(ListingForm, props));
    expect(empty.match(/<input\b[^>]*id="monthlyPrice"[^>]*>/)?.[0]).not.toContain('disabled=""');
  });
});
