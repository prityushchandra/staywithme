// Server-side Razorpay client. Private credentials never leave this module.
//
// Everything here is optional. Until the keys are set the whole online-booking
// path stays dark and Reserve falls back to the WhatsApp flow, so a missing key
// is never a crash — call `razorpayConfigured()` before offering to take money.
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const API_BASE = "https://api.razorpay.com/v1";

/** True when the server has the keys it needs to create and verify an order. */
export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** The publishable key the browser needs to open Checkout, or null. */
export function razorpayPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || null;
}

function authHeader(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) throw new Error("Online payments are not configured yet");
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

type RazorpayErrorBody = { error?: { description?: string; code?: string } };

async function razorpayRequest<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok) {
    const desc =
      (data as RazorpayErrorBody)?.error?.description ||
      `Payment gateway ${method} ${path} failed (${res.status})`;
    throw new Error(desc);
  }
  return data as T;
}

const orderSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string(),
});

export type RazorpayOrder = z.infer<typeof orderSchema>;

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  return orderSchema.parse(await razorpayRequest<unknown>(`/orders/${encodeURIComponent(orderId)}`, "GET"));
}

/**
 * Create an order. `amountPaise` is passed through untouched — the rest of this
 * codebase already stores money in paise, which is also Razorpay's unit.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes?: Record<string, string>
): Promise<RazorpayOrder> {
  return orderSchema.parse(await razorpayRequest<unknown>("/orders", "POST", {
    amount: Math.round(amountPaise),
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  }));
}

const paymentSchema = z.object({
  id: z.string().min(1),
  order_id: z.string().nullable(),
  status: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  created_at: z.number().int().positive(),
  captured: z.boolean(),
  method: z.string().nullish(),
  amount_refunded: z.number().int().nonnegative(),
  fee: z.number().int().nonnegative().nullable(),
  tax: z.number().int().nonnegative().nullable(),
});

export type RazorpayPayment = z.infer<typeof paymentSchema>;

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return paymentSchema.parse(await razorpayRequest<unknown>(`/payments/${encodeURIComponent(paymentId)}`, "GET"));
}

/**
 * Every payment attached to an order. Used as a reconciliation fallback when the
 * browser dies between Razorpay debiting the guest and our verify call landing:
 * the money exists, so we look it up rather than losing the booking.
 */
export async function listRazorpayOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
  const data = await razorpayRequest<unknown>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    "GET"
  );
  return z.object({ items: z.array(paymentSchema) }).parse(data).items;
}

const settlementSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().optional(),
  status: z.string(),
  fees: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  utr: z.string().nullable(),
  created_at: z.number().int().positive(),
});

const settlementTransactionSchema = z.object({
  entity_id: z.string().min(1),
  type: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  credit: z.number().int().nonnegative(),
  debit: z.number().int().nonnegative(),
  fee: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  on_hold: z.boolean(),
  settled: z.boolean(),
  created_at: z.number().int().positive(),
  settled_at: z.number().int().nonnegative().nullable(),
  settlement_id: z.string().nullable(),
  settlement_utr: z.string().nullable(),
  order_id: z.string().nullable(),
  payment_id: z.string().nullable(),
});

export type RazorpaySettlement = z.infer<typeof settlementSchema>;
export type RazorpaySettlementTransaction = z.infer<typeof settlementTransactionSchema>;
export type RazorpayCollection<T> = { items: T[]; truncated: boolean };

async function collectRazorpay<T>(
  path: string, params: Record<string, string>, schema: z.ZodType<T>
): Promise<RazorpayCollection<T>> {
  const items: T[] = [];
  const pageSize = 100;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ ...params, count: String(pageSize), skip: String(page * pageSize) });
    const data = await razorpayRequest<unknown>(`${path}?${query}`, "GET");
    const batch = z.object({ items: z.array(schema) }).parse(data).items;
    items.push(...batch);
    if (batch.length < pageSize) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export function listRazorpayPayments(from: number, to: number) {
  return collectRazorpay("/payments", { from: String(from), to: String(to) }, paymentSchema);
}

export function listRazorpaySettlements(from: number, to: number) {
  return collectRazorpay("/settlements", { from: String(from), to: String(to) }, settlementSchema);
}

export function listRazorpaySettlementTransactions(year: number, month: number) {
  return collectRazorpay("/settlements/recon/combined", {
    year: String(year), month: String(month),
  }, settlementTransactionSchema);
}

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Checkout handler signature: HMAC_SHA256(`${orderId}|${paymentId}`, keySecret). */
export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET). */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}
