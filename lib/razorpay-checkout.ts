"use client";

// Client helper that opens Razorpay Checkout. The script is loaded on demand so
// the 60 kB of gateway JavaScript never touches a guest who is only browsing.
// Resolves with the handler payload (which the caller posts to our verify
// route), or rejects when the guest closes the sheet or the payment fails.
//
// Unlike the sibling Mealbox implementation this does NOT lock the sheet to UPI
// — a stay costs thousands of rupees, so cards and netbanking must stay on.

export type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/**
 * Tells the caller why checkout ended without success:
 *  • "dismissed" — the guest closed the sheet themselves.
 *  • "failed"    — Razorpay reported an explicit failure.
 * The booking sheet uses this so someone who simply backed out isn't trapped on
 * a "confirming your payment" screen.
 */
export class RazorpayCheckoutError extends Error {
  reason: "dismissed" | "failed";
  constructor(reason: "dismissed" | "failed", message: string) {
    super(message);
    this.name = "RazorpayCheckoutError";
    this.reason = reason;
  }
}

type CheckoutOptions = {
  keyId: string;
  razorpayOrderId: string;
  amount: number; // paise
  currency: string;
  description: string;
  prefill: { name: string; contact: string; email: string };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Payment gateway unavailable"));
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Could not load the payment window"))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment window"));
    document.body.appendChild(script);
  });
}

export async function openRazorpayCheckout(
  opts: CheckoutOptions
): Promise<RazorpayHandlerResponse> {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Payment gateway unavailable");

  return new Promise<RazorpayHandlerResponse>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: opts.keyId,
      order_id: opts.razorpayOrderId,
      amount: opts.amount,
      currency: opts.currency,
      name: "StayWithMe",
      description: opts.description,
      prefill: opts.prefill,
      theme: { color: "#0f766e" },
      handler: (response: RazorpayHandlerResponse) => resolve(response),
      modal: {
        confirm_close: true,
        ondismiss: () => reject(new RazorpayCheckoutError("dismissed", "Payment cancelled")),
      },
    });
    rzp.on("payment.failed", (response: unknown) => {
      const err = response as { error?: { description?: string } };
      reject(
        new RazorpayCheckoutError(
          "failed",
          err?.error?.description || "Payment failed — please try again"
        )
      );
    });
    rzp.open();
  });
}
