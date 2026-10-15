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
// Razorpay animates its own teardown and only hides the container at the end of
// it, so a leftover is only suspicious once that animation has had time to run.
const OVERLAY_GRACE_MS = 600;
// A request that is merely *stalled* (captive portal, aggressive blocker) never
// fires onerror, so without a deadline the caller would wait forever.
const SCRIPT_TIMEOUT_MS = 20_000;

// Counts the checkouts this module has opened and not yet settled, so the
// stranded-overlay check below can never fire against a window that a second
// attempt has legitimately put back on screen.
let openCheckouts = 0;

/**
 * An overlay only matters if a tap actually lands on it, so ask the document
 * instead of trusting the style: a container that is hidden, zero-sized, fully
 * transparent to clicks or simply covered never comes back from
 * `elementFromPoint`. Several points are sampled because Razorpay's window is
 * full-screen on a phone but a centred card on a desktop.
 */
function isSwallowingTaps(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return [
    [w / 2, h / 2],
    [w / 2, h * 0.15],
    [w / 2, h * 0.85],
  ].some(([x, y]) => {
    const hit = document.elementFromPoint(Math.floor(x), Math.floor(y));
    return hit instanceof Node && el.contains(hit);
  });
}

/**
 * Razorpay keeps exactly one `.razorpay-container` for the lifetime of the
 * page: checkout.js builds it the moment it loads, parks its single checkout
 * <iframe> inside it, and reuses both for every `new Razorpay(...)`. Closing a
 * window hides that container rather than removing it, so finding one in the
 * DOM after checkout is normal and must be left alone — detaching it strands
 * the cached iframe, whose `contentWindow` then reads null forever, and the
 * next `open()` gives up with Razorpay's own "This browser is not supported"
 * alert.
 *
 * Hiding it is safe, because opening a window sets `display: block` again. We
 * only do that when the container has genuinely been left on screen and is
 * intercepting taps, which happens when the frame never acknowledges the
 * `close()` we post into it — it has not finished loading, or the connection
 * died mid-payment. Left alone that empty full-screen layer sits at the
 * maximum z-index and swallows every press on the listing underneath.
 */
function hideStrandedCheckoutOverlay() {
  if (typeof document === "undefined") return;
  if (openCheckouts > 0) return;
  document.querySelectorAll<HTMLElement>(".razorpay-container").forEach((el) => {
    if (isSwallowingTaps(el)) el.style.display = "none";
  });
}

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
    const settle = () => {
      if (settled) return false;
      settled = true;
      openCheckouts--;
      window.setTimeout(hideStrandedCheckoutOverlay, OVERLAY_GRACE_MS);
      return true;
    };
    const succeed = (r: RazorpayHandlerResponse) => {
      if (settle()) resolve(r);
    };
    const fail = (e: Error) => {
      if (settle()) reject(e);
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
    // A container still up from an earlier attempt would cover this one, and
    // opening resets it to `display: block` anyway, so clear it first.
    hideStrandedCheckoutOverlay();
    openCheckouts++;
    rzp.open();
  });
}
