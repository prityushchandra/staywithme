import { describe, expect, it } from "vitest";
import { normalizeOfflineGuests, offlineGuestDetailsSchema } from "./offline-booking-guests";

describe("manual guest details", () => {
  it("uses the booking's primary name while preserving supplied companion names", () => {
    expect(normalizeOfflineGuests("Primary Guest", [
      { position: 0, name: "Outdated primary name" },
      { position: 2, name: "Third Guest" },
    ], 3)).toEqual([
      { position: 0, name: "Primary Guest" }, { position: 2, name: "Third Guest" },
    ]);
    expect(normalizeOfflineGuests("Primary Guest", undefined, 1)).toEqual([
      { position: 0, name: "Primary Guest" },
    ]);
  });

  it("rejects duplicate positions and details outside the declared guest count", () => {
    expect(() => normalizeOfflineGuests("Primary", [
      { position: 1, name: "One" }, { position: 1, name: "Two" },
    ], 2)).toThrow("different position");
    expect(() => normalizeOfflineGuests("Primary", [{ position: 2, name: "Three" }], 2))
      .toThrow("guest count");
  });

  it("validates and trims names and rejects invalid guest positions", () => {
    expect(offlineGuestDetailsSchema.parse([{ position: 1, name: "  Companion  " }]))
      .toEqual([{ position: 1, name: "Companion" }]);
    for (const guest of [
      { position: -1, name: "Guest" }, { position: 50, name: "Guest" },
      { position: 1.5, name: "Guest" }, { position: 1, name: " " },
    ]) {
      expect(offlineGuestDetailsSchema.safeParse([guest]).success).toBe(false);
    }
  });
});
