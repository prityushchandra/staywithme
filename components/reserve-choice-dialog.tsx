"use client";

import { useState } from "react";
import { ArrowUpRight, BadgeIndianRupee, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { formatINR } from "@/lib/pricing";

// The fork in the road after Reserve: the same flat is listed on Airbnb, so we
// show the guest both doors and are honest about the difference. Booking direct
// is cheaper for them and keeps the service fee with us, so it leads — but the
// Airbnb button is never hidden or made to look broken.
//
// WhatsApp stands with them as a full third door rather than a footnote: it is
// the only one that is open on every listing, and it is what a guest wants when
// they'd rather ask a question than commit to a checkout.

export type ReserveChoice = "airbnb" | "direct" | "whatsapp";

export function ReserveChoiceDialog({
  open,
  onOpenChange,
  airbnbUrl,
  canPayOnline,
  total,
  nights,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  airbnbUrl?: string | null;
  canPayOnline: boolean;
  total: number;
  nights: number;
  onChoose: (choice: ReserveChoice) => void;
}) {
  const [busy, setBusy] = useState<ReserveChoice | null>(null);

  // `busy` only has to survive one open session — it is there so a double-tap
  // can't fire two actions. The parent closes this sheet by flipping `open`
  // itself, and Radix calls `onOpenChange` only for dismissals the guest drives
  // (Escape, outside tap, the close button), so resetting there alone left the
  // flag set for good: pick an option once and every option came back greyed
  // out the next time Reserve was pressed. Clearing it from `open` instead
  // covers every way the sheet can close, and doing it during render means a
  // re-opened sheet is never painted with dead buttons.
  if (!open && busy !== null) setBusy(null);

  // Radix keeps the content mounted while it slides away, so the buttons are
  // still tappable for a beat after the parent has closed us — which is exactly
  // when an impatient second tap lands. Treat "on the way out" as locked too.
  const locked = busy !== null || !open;

  function choose(choice: ReserveChoice) {
    if (locked) return;
    setBusy(choice);
    onChoose(choice);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setBusy(null);
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto gap-5 rounded-t-3xl p-6 sm:max-w-lg sm:rounded-3xl sm:p-7"
      >
        <div>
          <SheetTitle className="text-xl">How would you like to book?</SheetTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {nights} night{nights === 1 ? "" : "s"} · {formatINR(total)} with us
          </p>
        </div>

        {canPayOnline && (
          <button
            type="button"
            disabled={locked}
            onClick={() => choose("direct")}
            className="group relative overflow-hidden rounded-2xl border-2 border-brand bg-brand/5 p-4 text-left transition hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <span className="absolute right-3 top-3 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              Best price
            </span>
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <div className="pr-20">
                <p className="font-semibold">Book with us</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No Airbnb service fee, no accommodation tax on top, and our best
                  direct discount — you keep the difference, and we get to look
                  after you personally.
                </p>
                <ul className="mt-2.5 space-y-1 text-sm">
                  <li className="flex items-center gap-2">
                    <BadgeIndianRupee className="h-4 w-4 text-brand" />
                    Pay {formatINR(total)} — all inclusive
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-brand" />
                    Secure payment
                  </li>
                </ul>
              </div>
            </div>
          </button>
        )}

        {airbnbUrl && (
          <button
            type="button"
            disabled={locked}
            onClick={() => choose("airbnb")}
            className="rounded-2xl border p-4 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <div className="flex items-start gap-3">
              <ArrowUpRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-semibold">Book on Airbnb</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prefer Airbnb&apos;s checkout? We&apos;ll open the same flat on
                  their site. Their service fee and taxes apply.
                </p>
              </div>
            </div>
          </button>
        )}

        <button
          type="button"
          disabled={locked}
          onClick={() => choose("whatsapp")}
          className="rounded-2xl border p-4 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#128C7E]" />
            <div>
              <p className="font-semibold">Message us on WhatsApp</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask anything about the flat, sort out a late check-in, or talk
                through a better rate for a longer stay. A real person reads
                every message and replies — no bots, no forms.
              </p>
            </div>
          </div>
        </button>
      </SheetContent>
    </Sheet>
  );
}
