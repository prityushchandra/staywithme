import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPaymentsPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), report: vi.fn(), bookings: vi.fn(), configured: vi.fn(),
  redirect: vi.fn(() => { throw new Error("redirect"); }),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { booking: { findMany: mocks.bookings } } }));
vi.mock("@/lib/razorpay", () => ({ razorpayConfigured: mocks.configured }));
vi.mock("@/lib/razorpay-report", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/razorpay-report")>(), getRazorpayReport: mocks.report,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));

const page = (month = "2026-11") => AdminPaymentsPage({ searchParams: Promise.resolve({ month }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T13:30:00Z"));
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
  mocks.auth.mockResolvedValue({ user: { isAdmin: true } });
  mocks.configured.mockReturnValue(true);
  mocks.bookings.mockResolvedValue([]);
  mocks.report.mockResolvedValue({
    month: "2026-11", loadedAt: 1794654000, truncated: false, payments: [], transactions: [],
    settlements: [{ id: "setl_synthetic", amount: 97640, fees: 0, tax: 0, status: "processed", utr: "synthetic-utr", created_at: 1794654000 }],
    totals: { gross: 0, refunds: 0, fees: 0, tax: 0, netPayments: 0, processedSettlements: 97640 },
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("admin Razorpay dashboard", () => {
  it.each([null, { user: { isAdmin: false } }])("does not load financial data for an unauthorized visitor", async (session) => {
    mocks.auth.mockResolvedValue(session);
    await expect(page()).rejects.toThrow("redirect");
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.bookings).not.toHaveBeenCalled();
  });

  it("shows UTRs but does not pass off a settlement creation timestamp as a confirmed settlement date", async () => {
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("synthetic-utr");
    expect(html).toContain("Next bank credit: date not provided");
    expect(html).toContain("Not reported");
    expect(html).toContain("settlement is Razorpay");
  });

  it("rejects an invalid or future month without calling the gateway", async () => {
    expect(renderToStaticMarkup(await page("2026-99"))).toContain("Choose a valid month");
    expect(renderToStaticMarkup(await page("2026-12"))).toContain("Choose a valid month");
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("shows an explicit failure, not zero totals, when Razorpay cannot be queried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.report.mockRejectedValue(new Error("Provider unavailable"));
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("No totals are shown");
    expect(html).not.toContain("Processed transfers");
  });
});
