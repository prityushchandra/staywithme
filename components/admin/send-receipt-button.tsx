"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";

/**
 * "Send receipt" on an offline booking.
 *
 * Primary path (mobile): fetch the receipt PDF and hand the ACTUAL file to the
 * OS share sheet via the Web Share API, so the admin can drop the real PDF into
 * the guest's WhatsApp chat (with the payment message as the caption).
 *
 * Fallback (desktops / browsers without file-sharing): open a wa.me chat with
 * the prefilled text that links to the receipt — the best a plain wa.me link
 * can do, since WhatsApp's URL scheme cannot attach files.
 */
export function SendReceiptButton({
  receiptUrl,
  fallbackLink,
  message,
  fileName,
}: {
  /** Public receipt URL (carries ?t=<token>) used to fetch the PDF bytes. */
  receiptUrl: string;
  /** wa.me link with the prefilled text — used when file sharing is unavailable. */
  fallbackLink: string | null;
  /** Message shown to the guest (caption on mobile, body of the fallback link). */
  message: string;
  /** Friendly download name, e.g. "StayWithMe-Receipt-abc123.pdf". */
  fileName: string;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav?.canShare) {
        const res = await fetch(receiptUrl, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], fileName, { type: "application/pdf" });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], text: message, title: "Booking receipt" });
            return; // sent the actual PDF
          }
        }
      }
    } catch (err) {
      // User dismissed the share sheet — don't fall back to the link.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other error: fall through to the wa.me text link.
    } finally {
      setBusy(false);
    }
    if (fallbackLink) window.open(fallbackLink, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Send receipt on WhatsApp"
      className="group inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Send className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      )}
      {busy ? "Preparing…" : "Send receipt"}
    </button>
  );
}
