import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestContactActions } from "@/components/admin/guest-contact-actions";
import {
  buildGuestMessages,
  guestWhatsAppHref,
  type GuestMessageListing,
} from "./guest-messages";

const listing: GuestMessageListing = {
  title: "Example apartment",
  flatNumber: "B0908",
  block: "Example building",
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
const testDoorPin = "1234567";

beforeEach(() => {
  vi.stubEnv("GUEST_ONBOARDING_DOOR_PIN", testDoorPin);
});
afterEach(() => vi.unstubAllEnvs());

describe("confirmed guest messages", () => {
  it("separates onboarding details with blank lines and uses the flat's tower and numeric Airtel SSID", () => {
    const messages = buildGuestMessages("  Asha Singh  ", listing, testDoorPin);
    expect(messages.onboard).toBe([
      "Flat: B0908, B tower",
      "ssid: Airtel_0908",
      "pswd: Example@908+#&",
      `door pin: ${testDoorPin}`,
      "The flat is ready for checkin !",
      "Location: https://maps.app.goo.gl/GU1rU9Da7JbWe2227?g_st=ic",
      "For visitor parking , you can ask guard at B tower , he will guide you",
    ].join("\n\n"));
    expect(messages.checkout).toMatch(/^Hi Asha,/);
    expect(messages.checkout).toContain("checkout time is 11:15 AM");
    expect(messages.checkout).toContain("Please don't switch off WiFi and the fridge.");
    expect(messages.doorPin).toMatch(/^Hi Asha,/);
    expect(messages.doorPin).toContain('press "#" or the tick symbol');
    expect(messages.doorPin).toMatch(/\nPIN: $/);
  });

  it.each([
    ["G1407", "G", "1407"],
    ["G1601", "G", "1601"],
    ["G1606", "G", "1606"],
    ["D1203", "D", "1203"],
  ])("uses %s rather than a building name or another flat's WiFi name", (flatNumber, tower, number) => {
    const { onboard } = buildGuestMessages("Asha", { ...listing, flatNumber }, testDoorPin);
    expect(onboard).toContain(`Flat: ${flatNumber}, ${tower} tower`);
    expect(onboard).toContain(`ssid: Airtel_${number}\n`);
    expect(onboard).toContain(`guard at ${tower} tower`);
    expect(onboard).not.toContain("Example building");
    expect(onboard).not.toContain("Example_908");
  });

  it("uses the saved tower for numeric-only flats and never reuses another property's credentials", () => {
    buildGuestMessages("Asha Singh", listing, testDoorPin);
    const messages = buildGuestMessages("Rahul Mehta", {
      ...listing,
      flatNumber: "502",
      block: "Tower C",
      wifiName: "Example_502",
      wifiPassword: "Different password",
      checkOutTime: "9:45 AM",
    }, "7654321");
    expect(messages.onboard).toContain("Flat: 502, C tower");
    expect(messages.onboard).toContain("ssid: Airtel_502");
    expect(messages.onboard).toContain("pswd: Different password");
    expect(messages.onboard).toContain("door pin: 7654321");
    expect(messages.onboard).not.toContain(testDoorPin);
    expect(messages.checkout).toMatch(/^Hi Rahul,/);
    expect(messages.checkout).toContain("checkout time is 9:45 AM");
    expect(messages.doorPin).toMatch(/^Hi Rahul,/);
  });

  it("does not create incomplete onboarding instructions when listing details are missing", () => {
    const messages = buildGuestMessages(null, {
      ...listing,
      flatNumber: null,
      block: null,
      mapsUrl: null,
      wifiName: null,
      wifiPassword: null,
    }, testDoorPin);
    expect(messages.onboard).toBeNull();
    expect(messages.checkout).toMatch(/^Hi there,/);
    expect(messages.doorPin).toMatch(/^Hi there,/);
  });

  it("opens the selected guest's number and preserves the compact text, password symbols and map query", () => {
    const messages = buildGuestMessages("Asha", listing, testDoorPin);
    expect(messages.onboard).not.toBeNull();
    expect(guestWhatsAppHref("98765 43210", messages.onboard!)).toContain("%0A%0A");
    for (const message of [messages.onboard!, messages.checkout, messages.doorPin]) {
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
  it("puts the compact onboarding and personalized checkout/PIN links beside Call after confirmation", () => {
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
    }
    expect(hrefs.map((href) => new URL(href).searchParams.get("text"))).toEqual(
      Object.values(buildGuestMessages("Maya Patel", listing, testDoorPin))
    );
  });

  it("explains missing PIN configuration without linking incomplete onboarding or disabling other actions", () => {
    vi.stubEnv("GUEST_ONBOARDING_DOOR_PIN", " ");
    const html = renderToStaticMarkup(createElement(GuestContactActions, {
      phone: "9876543210", guestName: "Asha", status: "CONFIRMED", listing,
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Onboard unavailable");
    expect(html).not.toContain(" Onboard</a>");
    expect(html).toContain(" Checkout reminder</a>");
    expect(html).toContain(" Door PIN</a>");
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
      expect(html).not.toContain(testDoorPin);
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
