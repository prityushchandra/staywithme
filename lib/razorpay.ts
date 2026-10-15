// Razorpay, server side. A thin REST client rather than the SDK: there is one
// order to create and one signature to verify, so pulling in a dependency (and
// its types) earns nothing.
//
// Everything here is optional. Until the keys are set the whole online-booking
// path stays dark and Reserve falls back to the WhatsApp flow, so a missing key
// is never a crash — call `razorpayConfigured()` before offering to take money.
import { createHmac, timingSafeEqual } from "crypto";

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
  });
  const text = await res.text().catch(() => "");
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const desc =
      (data as RazorpayErrorBody)?.error?.description ||
      `Payment gateway ${method} ${path} failed (${res.status})`;
    throw new Error(desc);
  }
  return data as T;
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

/**
 * Create an order. `amountPaise` is passed through untouched — the rest of this
 * codebase already stores money in paise, which is also Razorpay's unit.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes?: Record<string, string>
): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>("/orders", "POST", {
    amount: Math.round(amountPaise),
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  });
}

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  status: string;
  amount: number;
  method?: string;
  email?: string;
  contact?: string;
};

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${paymentId}`, "GET");
}

/**
 * Every payment attached to an order. Used as a reconciliation fallback when the
 * browser dies between Razorpay debiting the guest and our verify call landing:
 * the money exists, so we look it up rather than losing the booking.
 */
export async function listRazorpayOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
  const data = await razorpayRequest<{ items?: RazorpayPayment[] }>(
    `/orders/${orderId}/payments`,
    "GET"
  );
  return data.items ?? [];
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
