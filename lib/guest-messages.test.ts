import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuestContactActions } from "@/components/admin/guest-contact-actions";
import {
  buildGuestMessages,
  guestWhatsAppHref,
  type GuestMessageListing,
} from "./guest-messages";

const listing: GuestMessageListing = {
  title: "Example apartment",
  flatNumber: "908",
  block: "B",
  addressLine: "Example Residences",
  city: "Bengaluru",
  country: "India",
  mapsUrl: "https://www.google.com/maps/@12.9,77.6,15z",
  lat: 12.9,
  lng: 77.6,
  checkInTime: "3:30 PM",
  checkOutTime: "11:15 AM",
  wifiName: "Example_908",
  wifiPassword: "Example@908+#&",
};

describe("confirmed guest messages", () => {
  it("personalizes all greetings and uses the booked listing's directions, times and WiFi", () => {
    const messages = buildGuestMessages("  Asha Singh  ", listing);
    for (const message of Object.values(messages)) expect(message).toMatch(/^Hi Asha,/);
    expect(messages.onboard).toContain("Tower B, flat 908");
    expect(messages.onboard).toContain("Once you reach Example Residences");
    expect(messages.onboard).toContain("https://www.google.com/maps/search/?api=1&query=12.9,77.6");
    expect(messages.onboard).toContain("Check-in: 3:30 PM");
    expect(messages.onboard).toContain("Check-out: 11:15 AM");
    expect(messages.onboard).toContain("Network: Example_908");
    expect(messages.onboard).toContain("Password: Example@908+#&");
    expect(messages.checkout).toContain("checkout time is 11:15 AM");
    expect(messages.checkout).toContain("Please don't switch off WiFi and the fridge.");
    expect(messages.doorPin).toContain('press "#" or the tick symbol');
    expect(messages.doorPin).toMatch(/\nPIN: $/);
  });

  it("never reuses another guest's name or another property's flat and WiFi", () => {
    buildGuestMessages("Asha Singh", listing);
    const messages = buildGuestMessages("Rahul Mehta", {
      ...listing,
      flatNumber: "502",
      block: "Tower C",
      wifiName: "Example_502",
      wifiPassword: "Different password",
      checkOutTime: "9:45 AM",
    });
    for (const message of Object.values(messages)) {
      expect(message).toMatch(/^Hi Rahul,/);
      expect(message).not.toContain("Asha");
    }
    expect(messages.onboard).toContain("Tower C, flat 502");
    expect(messages.onboard).not.toContain("Example_908");
    expect(messages.onboard).toContain("Password: Different password");
    expect(messages.checkout).toContain("checkout time is 9:45 AM");
  });

  it("omits unavailable WiFi details and builds a usable map from the listing's address", () => {
    const messages = buildGuestMessages(null, {
      ...listing,
      flatNumber: null,
      block: null,
      mapsUrl: null,
      wifiName: null,
      wifiPassword: null,
    });
    expect(messages.onboard).toContain("Hi there,");
    expect(messages.onboard).toContain("come to Example apartment");
    expect(messages.onboard).toContain(
      "https://www.google.com/maps/search/?api=1&query=Example%20Residences%2C%20Bengaluru%2C%20India"
    );
    expect(messages.onboard).not.toContain("WiFi Details");
    expect(messages.onboard).not.toMatch(/null|undefined|short code/i);
  });

  it("opens the selected guest's number and preserves newlines, WiFi symbols and the blank PIN", () => {
    const messages = buildGuestMessages("Asha", listing);
    for (const message of Object.values(messages)) {
      const href = guestWhatsAppHref("98765 43210", message);
      expect(href).not.toBeNull();
      const url = new URL(href!);
      expect(url.pathname).toBe("/919876543210");
      expect(url.searchParams.get("text")).toBe(message);
      expect(url.hash).toBe("");
    }
  });
});

describe("admin guest contact actions", () => {
  it("puts personalized onboarding, checkout and PIN links beside Call after confirmation", () => {
    const html = renderToStaticMarkup(createElement(GuestContactActions, {
      phone: "+44 7700 900123",
      guestName: "Maya Patel",
      status: "CONFIRMED",
      listing,
    }));
    expect(html).toContain('href="tel:+447700900123"');
    expect(html).toContain(" Onboard</a>");
    expect(html).toContain(" Checkout reminder</a>");
    expect(html).toContain(" Door PIN</a>");
    const hrefs = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)]
      .map((match) => match[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'"));
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      const url = new URL(href);
      expect(url.pathname).toBe("/447700900123");
      expect(url.searchParams.get("text")).toMatch(/^Hi Maya,/);
    }
  });

  it.each(["PENDING", "AWAITING_APPROVAL", "CANCELLED"])(
    "does not offer arrival instructions or door PIN for %s bookings",
    (status) => {
      const html = renderToStaticMarkup(createElement(GuestContactActions, {
        phone: "9876543210", guestName: "Asha", status, listing,
      }));
      expect(html).toContain("tel:+919876543210");
      expect(html).not.toContain("wa.me");
      expect(html).not.toContain("Onboard");
      expect(html).not.toContain("Door PIN");
    }
  );

  it("shows why contact actions are unavailable instead of building an invalid guest link", () => {
    const html = renderToStaticMarkup(createElement(GuestContactActions, {
      phone: "123", guestName: "Asha", status: "CONFIRMED", listing,
    }));
    expect(html).toContain("valid guest phone number");
    expect(html).not.toContain('href=');
  });
});
