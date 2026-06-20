import { describe, it, expect } from "vitest";
import {
  buildInquiryMessage,
  buildWhatsAppLink,
  normalizeWhatsAppNumber,
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
    expect(normalizeWhatsAppNumber("+91 8789194107")).toBe("918789194107");
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

  it("shows refCode as the Ref when provided, else the propertyId", () => {
    expect(buildInquiryMessage({ ...details, refCode: "K7M2Q" })).toContain("Ref: K7M2Q");
    expect(buildInquiryMessage(details)).toContain("Ref: 12345");
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
    const link = buildWhatsAppLink("+918789194107", details);
    expect(link.startsWith("https://wa.me/918789194107?text=")).toBe(true);
    const decoded = decodeURIComponent(link.split("text=")[1]);
    expect(decoded).toContain("Ocean View Villa");
    expect(decoded).toContain("Hi Chandra,");
  });
});
