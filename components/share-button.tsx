"use client";

import { useState } from "react";
import { Check, Share } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/**
 * "Share" on a listing page.
 *
 * Primary path (mobile): hand the link to the OS share sheet, which puts
 * WhatsApp first on most Indian phones — the way guests actually pass a flat
 * around, and the same route the receipt button already takes.
 *
 * Fallback (desktop / browsers without the Web Share API): copy the link and
 * say so, which is the useful half of sharing when there's no share sheet.
 *
 * The URL comes from the live address bar rather than being rebuilt, so any
 * dates the guest has already picked travel with the link and the recipient
 * opens the same stay instead of a blank listing.
 */
export function ShareButton({ title }: { title: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const url = window.location.href;
    const shareText = `${title} — on StayWithMe`;

    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text: shareText, url });
        return;
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure — don't then copy
        // a link the guest just chose not to send.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Anything else (no handler, blocked gesture): fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("Link copied");
    } catch {
      // Clipboard access needs a secure context and can be refused outright;
      // the address bar is still the guest's way out, so say what happened
      // rather than failing silently.
      toast("Couldn't copy — copy the address bar link");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Share ${title}`}
      className="flex items-center gap-1.5 rounded-full px-2 py-1.5 transition hover:bg-muted active:scale-95 sm:px-3"
    >
      {copied ? (
        <Check className="h-5 w-5 text-emerald-600" />
      ) : (
        <Share className="h-5 w-5" />
      )}
      <span className="hidden text-sm font-medium underline sm:inline">{copied ? "Copied" : "Share"}</span>
    </button>
  );
}
