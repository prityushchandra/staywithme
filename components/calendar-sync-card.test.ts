import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarSyncCard } from "./calendar-sync-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CalendarSyncCard", () => {
  it("renders the same last-synced timestamp across server and browser time zones", () => {
    const renderTimestamp = () => renderToStaticMarkup(createElement(CalendarSyncCard, {
      listingId: "listing-1",
      initialUrl: null,
      initialSyncedAt: "2026-01-15T23:45:00.000Z",
      initialError: null,
    })).match(/Last synced ([^<]+)/)?.[1];

    vi.stubEnv("TZ", "UTC");
    const serverTimestamp = renderTimestamp();
    vi.stubEnv("TZ", "Asia/Kolkata");
    const browserTimestamp = renderTimestamp();

    expect(serverTimestamp).toBeDefined();
    expect(browserTimestamp).toBe(serverTimestamp);
    expect(serverTimestamp).toBe("16/1/2026, 5:15:00 am IST.");
  });
});
