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
  /**
   * Handed a function that force-closes the gateway. The caller keeps it so it
   * can tear the window down if the guest abandons the booking from our side —
   * otherwise an orphaned Razorpay overlay would sit on top of the page with
   * nothing listening to it.
   */
  onReady?: (close: () => void) => void;
};

type RazorpayInstance = {
  open: () => void;
  close: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
// A request that is merely *stalled* (captive portal, aggressive blocker) never
// fires onerror, so without a deadline the caller would wait forever.
const SCRIPT_TIMEOUT_MS = 20_000;

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Payment gateway unavailable"));
    if (window.Razorpay) return resolve();

    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () =>
        done(
          new Error(
            "The payment window is taking too long to load. Check your connection or disable any ad blocker, then try again."
          )
        ),
      SCRIPT_TIMEOUT_MS
    );

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => done());
    script.addEventListener("error", () => done(new Error("Could not load the payment window")));
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export async function openRazorpayCheckout(
  opts: CheckoutOptions
): Promise<RazorpayHandlerResponse> {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Payment gateway unavailable");

  return new Promise<RazorpayHandlerResponse>((resolve, reject) => {
    // Razorpay can emit both `payment.failed` and `ondismiss` for one attempt;
    // whichever lands first wins and the rest are ignored.
    let settled = false;
    const succeed = (r: RazorpayHandlerResponse) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    const rzp = new window.Razorpay!({
      key: opts.keyId,
      order_id: opts.razorpayOrderId,
      amount: opts.amount,
      currency: opts.currency,
      name: "StayWithMe",
      description: opts.description,
      prefill: opts.prefill,
      theme: { color: "#0f766e" },
      // Retrying inside Razorpay's own window would leave our handler detached
      // from the second attempt, so a failure always comes back to us instead.
      retry: { enabled: false },
      handler: (response: RazorpayHandlerResponse) => succeed(response),
      modal: {
        // No "are you sure?" step: it renders inside Razorpay's iframe, and a
        // guest pressing Back expects to leave. Nothing is lost either way —
        // a dismissed checkout is reconciled against the gateway afterwards.
        confirm_close: false,
        escape: true,
        ondismiss: () => fail(new RazorpayCheckoutError("dismissed", "Payment cancelled")),
      },
    });
    rzp.on("payment.failed", (response: unknown) => {
      const err = response as { error?: { description?: string } };
      fail(
        new RazorpayCheckoutError(
          "failed",
          err?.error?.description || "Payment failed — please try again"
        )
      );
      try {
        rzp.close();
      } catch {
        /* already gone */
      }
    });
    opts.onReady?.(() => {
      try {
        rzp.close();
      } catch {
        /* already gone */
      }
    });
    rzp.open();
  });
}
