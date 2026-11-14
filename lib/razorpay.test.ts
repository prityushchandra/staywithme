import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRazorpayOrderPayments, listRazorpayPayments, verifyRazorpayWebhookSignature } from "./razorpay";

const payment = {
  id: "pay_synthetic", order_id: "order_synthetic", amount: 320000, currency: "INR", status: "captured",
  captured: true, created_at: 1794654000, amount_refunded: 0, fee: 7552, tax: 1152, method: "upi",
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RAZORPAY_KEY_ID", "synthetic-key");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "synthetic-secret");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "synthetic-webhook-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Razorpay report transport", () => {
  it("reads beyond the first API page with fixed date bounds and excludes unnecessary payment details", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      items: Array.from({ length: 100 }, (_, index) => ({ ...payment, id: `pay_${index}` })),
    })).mockResolvedValueOnce(Response.json({
      items: [{ ...payment, id: "pay_last", email: "synthetic@example.test", contact: "synthetic-private-contact" }],
    }));
    const result = await listRazorpayPayments(1793471400, 1794654000);
    expect(result.items).toHaveLength(101);
    expect(result.truncated).toBe(false);
    const secondUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(Object.fromEntries(secondUrl.searchParams)).toEqual({
      from: "1793471400", to: "1794654000", count: "100", skip: "100",
    });
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(result.items[100]).not.toHaveProperty("email");
    expect(result.items[100]).not.toHaveProperty("contact");
  });

  it("reports hitting the collection limit instead of presenting a partial report as complete", async () => {
    fetchMock.mockImplementation(async () => Response.json({
      items: Array.from({ length: 100 }, () => payment),
    }));
    const result = await listRazorpayPayments(1793471400, 1794654000);
    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("does not turn a malformed or failed payment lookup into an unpaid order", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ count: 0 }))
      .mockResolvedValueOnce(Response.json({ error: { description: "Gateway unavailable" } }, { status: 503 }));
    await expect(listRazorpayOrderPayments("order_synthetic")).rejects.toThrow();
    await expect(listRazorpayOrderPayments("order_synthetic")).rejects.toThrow("Gateway unavailable");
  });

  it("requires a signature over the exact webhook body and fails closed on malformed signatures", () => {
    const raw = '{ "event": "payment.captured" }';
    const signature = createHmac("sha256", "synthetic-webhook-secret").update(raw).digest("hex");
    expect(verifyRazorpayWebhookSignature(raw, signature)).toBe(true);
    expect(verifyRazorpayWebhookSignature(raw.trim() + " ", signature)).toBe(false);
    expect(verifyRazorpayWebhookSignature(raw, "z".repeat(64))).toBe(false);
    expect(verifyRazorpayWebhookSignature(raw, "")).toBe(false);
  });
});
