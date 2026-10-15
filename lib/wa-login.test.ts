import { describe, it, expect } from "vitest";
import { senderMatchesClaim, parseWaLoginCode } from "./wa-login";

describe("senderMatchesClaim", () => {
  it("accepts the number the sign-in was started for", () => {
    expect(senderMatchesClaim("+919876543210", "+919876543210")).toBe(true);
  });

  it("rejects a code sent from a different WhatsApp number", () => {
    expect(senderMatchesClaim("+919876543210", "+919000000001")).toBe(false);
  });

  it("compares normalized numbers, so formatting differences still match", () => {
    expect(senderMatchesClaim("98765 43210", "+919876543210")).toBe(true);
    expect(senderMatchesClaim("+91 98765-43210", "919876543210")).toBe(true);
  });

  it("binds to the sender when no number was declared", () => {
    expect(senderMatchesClaim(null, "+919876543210")).toBe(true);
  });

  it("does not block a login when the stored claim is unusable", () => {
    expect(senderMatchesClaim("not-a-number", "+919876543210")).toBe(true);
  });

  it("rejects an unparseable sender against a real claim", () => {
    expect(senderMatchesClaim("+919876543210", "")).toBe(false);
  });
});

describe("parseWaLoginCode", () => {
  it("pulls the code out of the message we ask users to send", () => {
    expect(parseWaLoginCode("Verify my StayWithMe login: AB3D9K")).toBe("AB3D9K");
  });

  it("upper-cases so the match is case-insensitive", () => {
    expect(parseWaLoginCode("verify my staywithme login: ab3d9k")).toBe("AB3D9K");
  });

  it("ignores unrelated chatter", () => {
    expect(parseWaLoginCode("hi, is the flat still free?")).toBeNull();
  });
});
