import { describe, it, expect } from "vitest";
import {
  buildInquiryMessage,
  buildWhatsAppLink,
  normalizeWhatsAppNumber,
  toWhatsAppAppLink,
} from "./whatsapp";

const details = {
  propertyName: "Ocean View Villa",
  propertyId: "12345",
  guestName: "Asha",
  checkIn: "2026-07-10",
  checkOut: "2026-07-14",
  nights: 4,
  guests: 4,
  totalMinorUnits: 880000, // ₹8,800
};

describe("normalizeWhatsAppNumber", () => {
  it("strips spaces and plus signs to digits only", () => {
    expect(normalizeWhatsAppNumber("+91 9113805548")).toBe("919113805548");
  });
});

describe("toWhatsAppAppLink", () => {
  it("converts a wa.me link into a whatsapp:// deep link, keeping the prefilled text", () => {
    const link = toWhatsAppAppLink(
      "https://wa.me/919113805548?text=Verify%20my%20StayWithMe%20login%3A%20K7M2QX"
    );
    expect(link).toBe(
      "whatsapp://send?phone=919113805548&text=Verify%20my%20StayWithMe%20login%3A%20K7M2QX"
    );
  });

  it("round-trips through the built link so the sent message is unchanged", () => {
    const code = "K7M2QX";
    const message = `Verify my StayWithMe login: ${code}`;
    const waLink = `https://wa.me/919113805548?text=${encodeURIComponent(message)}`;
    const deepLink = toWhatsAppAppLink(waLink)!;
    const text = new URLSearchParams(deepLink.split("?")[1]).get("text");
    expect(text).toBe(message);
  });

  it("handles a link with no prefilled text", () => {
    expect(toWhatsAppAppLink("https://wa.me/919113805548")).toBe(
      "whatsapp://send?phone=919113805548&text="
    );
  });

  it("returns null for missing, malformed, or phone-less links", () => {
    expect(toWhatsAppAppLink(null)).toBeNull();
    expect(toWhatsAppAppLink("")).toBeNull();
    expect(toWhatsAppAppLink("not a url")).toBeNull();
    expect(toWhatsAppAppLink("https://wa.me/")).toBeNull();
  });
});

describe("buildInquiryMessage", () => {
  it("greets the contact and includes the reservation details", () => {
    const msg = buildInquiryMessage(details);
    expect(msg).toContain("Hi Chandra,");
    expect(msg).toContain("this is *Asha*");
    expect(msg).toContain("Ocean View Villa");
    expect(msg).toContain("Check-in: 2026-07-10");
    expect(msg).toContain("Check-out: 2026-07-14");
    expect(msg).toContain("Nights: 4");
    expect(msg).toContain("Guests: 4");
    expect(msg).toContain("Total: *₹8,800*");
  });

  it("labels the refCode as the Property ID, falling back to the propertyId", () => {
    const withRef = buildInquiryMessage({ ...details, refCode: "K7M2Q" });
    expect(withRef).toContain("Property ID / Ref: K7M2Q");
    expect(buildInquiryMessage(details)).toContain("Ref: 12345");
  });

  it("keeps the Ref token the webhook parses out of forwarded enquiries", () => {
    const re = /Ref:\s*([a-z0-9]{5,})/i;
    expect(buildInquiryMessage({ ...details, refCode: "K7M2Q" }).match(re)?.[1]).toBe(
      "K7M2Q"
    );
    expect(buildInquiryMessage(details).match(re)?.[1]).toBe("12345");
  });

  it("omits the Property ID label (and never prints undefined) without a refCode", () => {
    for (const refCode of [undefined, "", "   "]) {
      const msg = buildInquiryMessage({ ...details, refCode });
      expect(msg).not.toContain("Property ID");
      expect(msg).not.toContain("undefined");
      expect(msg).toContain("Ref: 12345");
    }
  });

  it("computes nights from the dates when not provided", () => {
    const msg = buildInquiryMessage({
      propertyName: "Cabin",
      propertyId: "1",
      checkIn: "2026-01-01",
      checkOut: "2026-01-04",
      totalMinorUnits: 110000,
    });
    expect(msg).toContain("Nights: 3");
  });

  it("falls back gracefully when dates/guest are not selected", () => {
    const msg = buildInquiryMessage({
      propertyName: "Cabin",
      propertyId: "1",
      totalMinorUnits: 110000,
    });
    expect(msg).toContain("Check-in: —");
    expect(msg).toContain("Check-out: —");
    expect(msg).toContain("Nights: —");
    expect(msg).toContain("Guests: —");
  });
});

describe("buildWhatsAppLink", () => {
  it("always routes to the platform number and URL-encodes the message", () => {
    const link = buildWhatsAppLink("+919113805548", details);
    expect(link.startsWith("https://wa.me/919113805548?text=")).toBe(true);
    const decoded = decodeURIComponent(link.split("text=")[1]);
    expect(decoded).toContain("Ocean View Villa");
    expect(decoded).toContain("Hi Chandra,");
  });

  it("carries the Property ID through the encoded message", () => {
    const link = buildWhatsAppLink("+919113805548", { ...details, refCode: "HAXGT" });
    const decoded = decodeURIComponent(link.split("text=")[1]);
    expect(decoded).toContain("Property ID / Ref: HAXGT");
  });
});
