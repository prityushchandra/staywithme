"use client";

import { useState } from "react";

// WhatsApp brand glyph (lucide has no brand icons).
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

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
      className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2 py-0.5 text-xs font-medium text-white transition hover:brightness-105 disabled:opacity-60"
    >
      <WhatsAppIcon /> {busy ? "Preparing…" : "Send receipt"}
    </button>
  );
}
