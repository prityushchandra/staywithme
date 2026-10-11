"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WhatsAppContactButton } from "@/components/whatsapp-contact-button";
import { useToast } from "@/components/ui/toast";
import { useBooking, type ReserveCta } from "@/components/booking-context";
import { datePromptMessage, isSufficientlyVisible } from "@/lib/reserve-prompt";
import {
  compareQuote,
  parseFreshQuote,
  type FreshQuote,
  type QuoteOutcome,
} from "@/lib/quote-check";
import { cn } from "@/lib/utils";

// The page's ONE Reserve button. The booking card resolves what Reserve should
// do and publishes it to the booking context; only the active surface (the card
// on desktop, the floating tab on mobile) renders this, so the guest never sees
// two Reserve buttons.
//
// When the trip still needs dates, Reserve takes the guest down to the booking
// card and opens its date picker, so picking dates, checking the total and
// reserving all happen in one place. If the picker is already open and the
// dates are still missing, scrolling or re-opening would look broken, so a
// small toast says what's missing instead.
//
// When everything IS set, the click first re-checks price and availability
// against the database. The listing page is ISR-cached, so the figures on
// screen can be minutes old — this is what stops a guest sending WhatsApp a
// message for nights that were booked, or at yesterday's price.

/** The booking card, which owns the date picker and the price breakdown. */
const BOOK_SECTION_ID = "book";
/** The sticky navbar covers the top of the viewport. */
const NAVBAR_INSET = 64;
/** On compact screens the floating booking tab covers the bottom. */
const BOOKING_TAB_INSET = 96;
/** Abandon the live re-check after this and let the booking through. */
const QUOTE_TIMEOUT_MS = 4000;
/** How long an already-fetched quote stays good enough to act on. */
const QUOTE_FRESH_MS = 10_000;
/** A second press this soon after WhatsApp opened is a double-tap, not intent. */
const DOUBLE_TAP_MS = 1500;

type ReadyCta = Extract<ReserveCta, { kind: "ready" }>;
type QuoteResult = { outcome: QuoteOutcome; fresh: FreshQuote | null };
type QuoteCheck = {
  key: string;
  startedAt: number;
  promise: Promise<QuoteResult>;
  /** The settled result, or null while the request is still in flight. */
  peek: () => QuoteResult | null;
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Below `sm` the date picker opens as a fixed fullscreen overlay that locks
 * body scroll — the same gate `date-range-picker` uses. A smooth scroll started
 * just before that lock would freeze half-way, so the caller jumps instantly
 * instead; nobody sees it, because the overlay covers the page either way.
 */
function picksDatesFullscreen() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639.98px)").matches
  );
}

/** A short tint so the booking card the guest just landed on announces itself. */
function flashAttention(el: HTMLElement) {
  if (typeof el.animate !== "function" || prefersReducedMotion()) return;
  el.animate(
    [
      { backgroundColor: "rgba(200, 112, 94, 0)" },
      { backgroundColor: "rgba(200, 112, 94, 0.12)" },
      { backgroundColor: "rgba(200, 112, 94, 0)" },
    ],
    // Delayed so the smooth scroll has landed before the tint starts.
    { duration: 1200, delay: 320, easing: "ease-in-out" }
  );
}

/** Identifies a quote — a different stay, or a different price on screen,
 *  invalidates whatever we fetched last. */
function quoteKey(cta: ReadyCta) {
  const d = cta.details;
  return [d.propertyId, d.checkIn, d.checkOut, d.guests, d.infants, cta.quote.total].join(
    "|"
  );
}

/**
 * Ask the server what this stay really costs and whether it's still free.
 * Returns null whenever we couldn't get a trustworthy answer — offline, a
 * timeout, a 5xx, a malformed body. The caller treats null as "carry on": a
 * flaky connection must never cost a reservation, and the host confirms every
 * booking by hand on WhatsApp anyway.
 */
async function fetchFreshQuote(cta: ReadyCta): Promise<FreshQuote | null> {
  const { propertyId, checkIn, checkOut, guests, infants } = cta.details;
  if (!checkIn || !checkOut) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/listings/${encodeURIComponent(propertyId)}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkIn, checkOut, guests, infants }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseFreshQuote(await res.json());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function ReserveButton({
  cta,
  className,
}: {
  cta: ReserveCta;
  className?: string;
}) {
  const { isCompactLayout, setLiveListing, pickerOpen, setPickerOpen } = useBooking();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  /** The in-flight or just-settled quote for the current selection. */
  const checkRef = useRef<QuoteCheck | null>(null);
  /** True while a check is running, so a double-tap can't fire a second one. */
  const busyRef = useRef(false);
  /** Set just before we re-dispatch a cleared click on the WhatsApp link. */
  const bypassRef = useRef(false);
  /** When WhatsApp was last opened, so a double-tap doesn't send two messages. */
  const openedAtRef = useRef(0);

  // The floating tab is narrow, so it gets the terse label.
  const label = isCompactLayout ? cta.shortLabel : cta.label;

  /**
   * Take the guest to the booking card and open its date picker. That card is
   * where the dates, the total and Reserve all live, so it is the only place a
   * half-finished trip can actually be completed.
   */
  function revealDates() {
    const section = document.getElementById(BOOK_SECTION_ID);
    const fullscreen = picksDatesFullscreen();
    if (section) {
      const alreadyOnScreen = isSufficientlyVisible(
        section.getBoundingClientRect(),
        window.innerHeight,
        { top: NAVBAR_INSET, bottom: isCompactLayout ? BOOKING_TAB_INSET : 0 }
      );
      if (!alreadyOnScreen) {
        section.scrollIntoView({
          behavior: fullscreen || prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
        // Pointless behind a fullscreen overlay, and the guest lands on an
        // already-tinted card when they close it.
        if (!fullscreen) flashAttention(section);
      }
    }
    setPickerOpen(true);
  }

  // Re-opening a picker the guest is already looking at reads as broken, so
  // once it's open we nudge with a toast instead.
  function promptForDates(message: string) {
    if (pickerOpen) toast(message);
    else revealDates();
  }

  function startCheck(ready: ReadyCta): QuoteCheck {
    const key = quoteKey(ready);
    const current = checkRef.current;
    if (current && current.key === key && Date.now() - current.startedAt < QUOTE_FRESH_MS) {
      return current;
    }

    let result: QuoteResult | null = null;
    const promise = fetchFreshQuote(ready).then((fresh) => {
      result = fresh
        ? { outcome: compareQuote(ready.quote, fresh), fresh }
        : { outcome: { kind: "proceed" }, fresh: null };
      return result;
    });

    const check: QuoteCheck = {
      key,
      startedAt: Date.now(),
      promise,
      peek: () => result,
    };
    checkRef.current = check;
    return check;
  }

  function applyResult(result: QuoteResult, anchor: HTMLAnchorElement) {
    checkRef.current = null; // consumed — the next press asks again

    if (result.outcome.kind === "proceed") {
      // Re-fire the guest's own click so the WhatsApp link, its tracking beacon
      // and the message body all stay exactly as they were.
      openedAtRef.current = Date.now();
      bypassRef.current = true;
      anchor.click();
      // Safety net: if that click never reached our handler, don't leave the
      // next genuine press unchecked.
      window.setTimeout(() => {
        bypassRef.current = false;
      }, 0);
      return;
    }

    // Whatever the server just told us is now the truth on screen: the card and
    // the floating tab both read this override instead of the cached props.
    if (result.fresh) {
      setLiveListing({
        basePrice: result.fresh.basePrice,
        monthlyPrice: result.fresh.monthlyPrice,
        platformFeePercent: result.fresh.platformFeePercent,
        blockedRanges: result.fresh.blockedRanges,
      });
    }
    toast(result.outcome.message, { duration: 4500 });

    // Dates gone: reopen the picker, which now knows about the nights that
    // were taken. A price change deliberately does nothing else — the new
    // total is on screen and the guest presses Reserve again.
    if (result.outcome.kind === "unavailable") revealDates();
  }

  function handleReadyClick(event: React.MouseEvent<HTMLElement>, ready: ReadyCta) {
    if (bypassRef.current) {
      bypassRef.current = false; // our own re-dispatch — let it navigate
      return;
    }

    const anchor = (event.target as HTMLElement | null)?.closest?.(
      "a"
    ) as HTMLAnchorElement | null;
    if (!anchor) return;

    // Second tap while the first is still being checked, or right after
    // WhatsApp opened: swallow it rather than send a duplicate enquiry.
    if (busyRef.current || Date.now() - openedAtRef.current < DOUBLE_TAP_MS) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const check = startCheck(ready);
    const settled = check.peek();
    if (settled?.outcome.kind === "proceed") {
      // Warmed up on pointer-down and nothing moved — let the browser handle
      // the click natively, which keeps the link out of the popup blocker.
      checkRef.current = null;
      openedAtRef.current = Date.now();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (settled) {
      applyResult(settled, anchor);
      return;
    }

    busyRef.current = true;
    setChecking(true);
    check.promise
      .then((result) => applyResult(result, anchor))
      .finally(() => {
        busyRef.current = false;
        setChecking(false);
      });
  }

  if (cta.kind === "ready") {
    return (
      // `display: contents` leaves the button's own layout untouched; this
      // wrapper exists only to intercept the click before the link opens.
      <span
        className="contents"
        onPointerDownCapture={() => {
          // Head start, so the common "nothing changed" case usually resolves
          // before the click even lands.
          if (!busyRef.current && Date.now() - openedAtRef.current >= DOUBLE_TAP_MS) {
            startCheck(cta);
          }
        }}
        onClickCapture={(event) => handleReadyClick(event, cta)}
      >
        <WhatsAppContactButton
          className={cn(className, checking && "pointer-events-none opacity-80")}
          variant="brand"
          label={checking ? "Checking…" : label}
          whatsappNumber={cta.whatsappNumber}
          details={cta.details}
        />
      </span>
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
        onClick={() => promptForDates(datePromptMessage("unavailable"))}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant="brand"
      size="lg"
      className={className}
      onClick={() => promptForDates(datePromptMessage("incomplete", cta.missing))}
    >
      {label}
    </Button>
  );
}
