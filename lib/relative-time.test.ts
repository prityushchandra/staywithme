import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("phrases the units a reviewer would recognise", () => {
    expect(relativeTime(ago(DAY), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(14 * DAY), NOW)).toBe("2 weeks ago");
    expect(relativeTime(ago(120 * DAY), NOW)).toBe("4 months ago");
  });

  it("singularises exactly one of each unit", () => {
    expect(relativeTime(ago(MIN), NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(7 * DAY), NOW)).toBe("1 week ago");
    expect(relativeTime(ago(400 * DAY), NOW)).toBe("1 year ago");
  });

  it("switches units at the boundary rather than after it", () => {
    expect(relativeTime(ago(59 * SEC), NOW)).toBe("just now");
    expect(relativeTime(ago(60 * MIN - SEC), NOW)).toBe("59 minutes ago");
    expect(relativeTime(ago(24 * HOUR - SEC), NOW)).toBe("23 hours ago");
    expect(relativeTime(ago(7 * DAY - SEC), NOW)).toBe("6 days ago");
    expect(relativeTime(ago(30 * DAY - SEC), NOW)).toBe("4 weeks ago");
    expect(relativeTime(ago(365 * DAY - SEC), NOW)).toBe("12 months ago");
  });

  it("never reads as the future when the clock is skewed", () => {
    expect(relativeTime(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe("just now");
  });
});
