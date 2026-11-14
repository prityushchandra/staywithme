import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentRazorpayMonth, getRazorpayReport, razorpayMonthRange } from "./razorpay-report";

const mocks = vi.hoisted(() => ({ payments: vi.fn(), settlements: vi.fn(), transactions: vi.fn() }));
vi.mock("./razorpay", () => ({
  listRazorpayPayments: mocks.payments, listRazorpaySettlements: mocks.settlements,
  listRazorpaySettlementTransactions: mocks.transactions,
}));

const payment = {
  id: "pay_synthetic", order_id: "order_synthetic", status: "captured", captured: true,
  amount: 100000, amount_refunded: 10000, fee: 2360, tax: 360, currency: "INR", created_at: 1794654000,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T13:30:00Z"));
  mocks.payments.mockResolvedValue({ items: [payment], truncated: false });
  mocks.settlements.mockResolvedValue({ items: [
    { id: "setl_processed", amount: 87640, fees: 0, tax: 0, status: "processed", created_at: 1794654100 },
    { id: "setl_failed", amount: 50000, fees: 0, tax: 0, status: "failed", created_at: 1794654200 },
  ], truncated: false });
  mocks.transactions.mockResolvedValue({ items: [], truncated: false });
});
afterEach(() => vi.useRealTimers());

describe("Razorpay monthly report", () => {
  it("uses Indian month boundaries, including rollover, and does not request future transactions", () => {
    expect(currentRazorpayMonth(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
    expect(razorpayMonthRange("2026-10")).toMatchObject({
      from: Date.parse("2026-09-30T18:30:00Z") / 1000,
      to: Date.parse("2026-10-31T18:29:59Z") / 1000,
    });
    expect(razorpayMonthRange("2026-11").to).toBe(Date.now() / 1000);
    expect(() => razorpayMonthRange("2026-13")).toThrow("valid month");
    expect(() => razorpayMonthRange("2026-12")).toThrow("valid month");
  });

  it("does not subtract GST twice and counts only processed bank settlements", async () => {
    const report = await getRazorpayReport("2026-11");
    expect(report.totals).toEqual({
      gross: 100000, refunds: 10000, fees: 2360, tax: 360, netPayments: 87640, processedSettlements: 87640,
    });
    expect(mocks.transactions).toHaveBeenCalledWith(2026, 11);
  });

  it("excludes unsuccessful attempts but retains fully refunded payments in the gross and refund totals", async () => {
    mocks.payments.mockResolvedValue({ items: [
      payment, { ...payment, id: "failed", status: "failed", captured: false, amount: 999999, fee: null, tax: null },
      { ...payment, id: "refunded", status: "refunded", amount_refunded: 100000 },
    ], truncated: false });
    expect((await getRazorpayReport("2026-11")).totals).toMatchObject({
      gross: 200000, refunds: 110000, fees: 4720, netPayments: 85280,
    });
  });

  it("keeps unavailable fees and net amounts unknown, rather than treating missing fees as zero", async () => {
    mocks.payments.mockResolvedValue({ items: [{ ...payment, fee: null, tax: null }], truncated: false });
    expect((await getRazorpayReport("2026-11")).totals).toMatchObject({ fees: null, tax: null, netPayments: null });
  });

  it("flags an incomplete report and does not turn a failed API call into empty financial data", async () => {
    mocks.payments.mockResolvedValue({ items: [payment], truncated: true });
    expect((await getRazorpayReport("2026-11")).truncated).toBe(true);
    mocks.transactions.mockRejectedValue(new Error("Razorpay unavailable"));
    await expect(getRazorpayReport("2026-11")).rejects.toThrow("Razorpay unavailable");
  });

  it("does not add another currency to INR totals", async () => {
    mocks.payments.mockResolvedValue({ items: [{ ...payment, currency: "USD" }], truncated: false });
    await expect(getRazorpayReport("2026-11")).rejects.toThrow("INR");
  });
});
