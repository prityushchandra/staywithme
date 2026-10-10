"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsAppContactButton } from "@/components/whatsapp-contact-button";
import { useBooking, type ReserveCta } from "@/components/booking-context";

// The page's ONE Reserve button. The booking card resolves what Reserve should
// do and publishes it to the booking context; only the active surface (the card
// on desktop, the floating tab on mobile) renders this, so the guest never sees
// two Reserve buttons. Tapping it with trip details missing opens a dialog
// listing them instead of silently doing nothing.
export function ReserveButton({
  cta,
  className,
}: {
  cta: ReserveCta;
  className?: string;
}) {
  const { isCompactLayout, setPickerOpen } = useBooking();
  const [issuesOpen, setIssuesOpen] = useState(false);

  // The floating tab is narrow, so it gets the terse label.
  const label = isCompactLayout ? cta.shortLabel : cta.label;

  function revealDatePicker() {
    setPickerOpen(true);
    // On mobile the button lives in the tab, far from the card holding the
    // calendar — bring it into view.
    if (isCompactLayout) {
      document
        .getElementById("book")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function fixMissingDetails() {
    setIssuesOpen(false);
    // Radix keeps the dialog mounted (and the page scroll locked) for its close
    // animation, so wait that out before opening/scrolling to the calendar.
    window.setTimeout(revealDatePicker, 220);
  }

  if (cta.kind === "ready") {
    return (
      <WhatsAppContactButton
        className={className}
        variant="brand"
        label={label}
        whatsappNumber={cta.whatsappNumber}
        details={cta.details}
      />
    );
  }

  if (cta.kind === "login") {
    return (
      <Button asChild variant="brand" size="lg" className={className}>
        <Link href={cta.href}>{label}</Link>
      </Button>
    );
  }

  if (cta.kind === "unavailable") {
    return (
      <Button
        variant="brand"
        size="lg"
        className={className}
        onClick={revealDatePicker}
      >
        {label}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="brand"
        size="lg"
        className={className}
        onClick={() => setIssuesOpen(true)}
      >
        {label}
      </Button>

      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent>
          <DialogTitle>Add your trip details</DialogTitle>
          <DialogDescription>
            We need a little more before your reservation request can go to the
            platform.
          </DialogDescription>
          <ul className="space-y-2 rounded-xl border bg-muted/40 p-3 text-sm">
            {cta.missing.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-brand" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Button
            variant="brand"
            size="lg"
            className="w-full"
            onClick={fixMissingDetails}
          >
            Choose dates
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
