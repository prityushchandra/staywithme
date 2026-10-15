"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  MessageCircle,
  Phone,
  Trash2,
  Upload,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/pricing";
import { openRazorpayCheckout, RazorpayCheckoutError } from "@/lib/razorpay-checkout";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp";

// "Book with us": the direct-payment path. Everything the admin needs to accept
// a stranger into a flat is collected here — a government ID per guest, why they
// are coming, and a number that actually rings — and the pay button stays locked
// until all of it is present.
//
// The uploads go up one at a time as they are chosen rather than in a single
// giant submit: a 4-guest booking is 4 small requests instead of one 16 MB one,
// and the guest sees each ID land instead of staring at a spinner.

const ACCEPT = "image/jpeg,image/png,application/pdf";
const MAX_DOC_BYTES = 4 * 1024 * 1024;

type UploadedDoc = { id: string; name: string; docName: string; docSize: number };
/**
 * "paying" spans order creation and the gateway window; "verifying" is the few
 * seconds after Razorpay hands back a signature, which must not be interrupted.
 */
type Stage = "form" | "paying" | "verifying" | "done";

function prettySize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BookDirectSheet({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  checkIn,
  checkOut,
  nights,
  guests,
  total,
  guestName,
  guestPhone,
  whatsappNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  guestName?: string;
  guestPhone?: string;
  whatsappNumber: string;
}) {
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState(guestPhone ?? "");
  const [names, setNames] = useState<string[]>(() =>
    Array.from({ length: guests }, (_, i) => (i === 0 ? guestName ?? "" : ""))
  );
  const [docs, setDocs] = useState<(UploadedDoc | null)[]>(() =>
    Array.from({ length: guests }, () => null)
  );
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);
  // Set while Razorpay's window is up, so we can tear it down if the guest
  // backs out of the booking from our side instead of theirs.
  const closeCheckout = useRef<(() => void) | null>(null);

  // Guest count can change behind the sheet (the card is still live); keep the
  // per-guest rows in step without discarding what has already been uploaded.
  useEffect(() => {
    setNames((prev) =>
      Array.from({ length: guests }, (_, i) => prev[i] ?? (i === 0 ? guestName ?? "" : ""))
    );
    setDocs((prev) => Array.from({ length: guests }, (_, i) => prev[i] ?? null));
  }, [guests, guestName]);

  const startDraft = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: propertyId, checkIn, checkOut, guests }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start your booking.");
      setBookingId(data.bookingId as string);
      // A reused draft may already carry IDs from an abandoned attempt.
      const existing = (data.docs ?? []) as UploadedDoc[];
      if (existing.length) {
        setDocs((prev) => prev.map((d, i) => existing[i] ?? d));
        setNames((prev) => prev.map((n, i) => existing[i]?.name ?? n));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start your booking.");
    } finally {
      setStarting(false);
    }
  }, [propertyId, checkIn, checkOut, guests]);

  // Open the draft as soon as the sheet appears so the ID uploads have somewhere
  // to go. Re-opening after a reset starts a fresh one. Only ever while the
  // form is up: a draft created mid-payment would race the attempt in flight.
  useEffect(() => {
    if (open && !bookingId && !starting && stage === "form") void startDraft();
  }, [open, bookingId, starting, stage, startDraft]);

  // A draft belongs to the dates and headcount it was created with, and the
  // booking card behind this sheet stays live — the gateway stage deliberately
  // stands down to non-modal so a stuck payment window can't trap anyone. If
  // the trip moves, the draft on hand is for a stay the guest has left, so drop
  // it; the effect above then opens one for the trip actually on screen.
  const tripKey = `${propertyId}|${checkIn}|${checkOut}|${guests}`;
  const lastTrip = useRef(tripKey);
  useEffect(() => {
    if (lastTrip.current === tripKey) return;
    lastTrip.current = tripKey;
    setBookingId(null);
    setDocs(Array.from({ length: guests }, () => null));
    setError(null);
  }, [tripKey, guests]);

  async function uploadDoc(index: number, file: File) {
    const name = names[index]?.trim();
    if (!name) {
      setError(`Enter guest ${index + 1}'s name before uploading their ID.`);
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setError(`${file.name} is larger than 4 MB. Please upload a smaller scan.`);
      return;
    }
    if (!bookingId) return;

    setUploading(index);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", name);
      const res = await fetch(`/api/bookings/online/${bookingId}/docs`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setDocs((prev) => prev.map((d, i) => (i === index ? (data.doc as UploadedDoc) : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
      const input = fileInputs.current[index];
      if (input) input.value = "";
    }
  }

  async function removeDoc(index: number) {
    const doc = docs[index];
    if (!doc || !bookingId) return;
    setDocs((prev) => prev.map((d, i) => (i === index ? null : d)));
    await fetch(`/api/bookings/online/${bookingId}/docs?docId=${encodeURIComponent(doc.id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  const allDocsIn = docs.every((d) => d !== null);
  const allNamesIn = names.every((n) => n.trim().length > 1);
  const ready =
    Boolean(bookingId) &&
    allDocsIn &&
    allNamesIn &&
    reason.trim().length >= 3 &&
    phone.trim().length >= 6;

  async function pay() {
    if (!bookingId || !ready) return;
    setStage("paying");
    setError(null);
    try {
      const res = await fetch(`/api/bookings/online/${bookingId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonForVisit: reason.trim(), contactPhone: phone.trim() }),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(order.error || "Could not start the payment.");

      const handler = await openRazorpayCheckout({
        keyId: order.keyId,
        razorpayOrderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency ?? "INR",
        description: order.description ?? propertyName,
        prefill: { name: names[0] || guestName || "", contact: phone.trim(), email: "" },
        onReady: (dismiss) => {
          closeCheckout.current = dismiss;
        },
      });
      closeCheckout.current = null;

      setStage("verifying");
      const verify = await fetch(`/api/bookings/online/${bookingId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handler),
      });
      const result = await verify.json().catch(() => ({}));
      if (!verify.ok) throw new Error(result.error || "We could not confirm that payment.");
      setStage("done");
    } catch (err) {
      closeCheckout.current = null;
      // A dismissed sheet is not a failure — but the guest may still have been
      // debited in a flaky network, so ask the gateway before giving up.
      if (err instanceof RazorpayCheckoutError && err.reason === "dismissed" && bookingId) {
        setStage("verifying");
        const recon = await fetch(`/api/bookings/online/${bookingId}/verify`, { method: "POST" })
          .then((r) => r.json())
          .catch(() => ({ paid: false }));
        if (recon?.paid) {
          setStage("done");
          return;
        }
        setStage("form");
        return;
      }
      setError(err instanceof Error ? err.message : "Payment failed.");
      setStage("form");
    }
  }

  /** Escape hatch for the rare case where the gateway never opens at all. */
  function abandonPayment() {
    closeCheckout.current?.();
    closeCheckout.current = null;
    setStage("form");
  }

  function close(next: boolean) {
    // Only the verify round-trip is genuinely uninterruptible. Blocking the
    // whole payment stage is what used to trap guests whose gateway window
    // failed to appear.
    if (!next && stage === "verifying") return;
    if (!next) {
      if (stage === "paying") {
        closeCheckout.current?.();
        closeCheckout.current = null;
      }
      // Every close starts the next attempt from scratch. Keeping the draft
      // used to mean a guest who backed out of a payment, picked new dates and
      // reserved again was handed the *old* booking: the draft effect sees an
      // id and never asks for another, so they would have paid for the stay
      // they just moved away from. Reopening on unchanged dates costs nothing
      // — the server hands the same draft and its uploads straight back.
      setStage("form");
      setBookingId(null);
      setDocs(Array.from({ length: guests }, () => null));
      setError(null);
    }
    onOpenChange(next);
  }

  const waNumber = normalizeWhatsAppNumber(whatsappNumber);
  const callHref = `tel:+${waNumber}`;
  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(
    `Hi Chandra, I've just paid for ${propertyName} (${checkIn} to ${checkOut}). Could you please confirm my booking?`
  )}`;
  const waHelpLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(
    `Hi Chandra, I'm booking ${propertyName} (${checkIn} to ${checkOut}) and need some help.`
  )}`;

  return (
    // Radix locks the page while a modal dialog is open: it sets
    // `pointer-events: none` on <body> and traps focus inside the sheet.
    // Razorpay injects its window as a sibling of our portal, so under those
    // rules it renders but cannot be clicked or typed into — the guest sees a
    // frozen payment screen. Standing down to non-modal for the duration of
    // the gateway hands the page back.
    <Sheet open={open} onOpenChange={close} modal={stage === "form" || stage === "done"}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] gap-5 rounded-t-3xl p-6 sm:max-w-lg sm:rounded-3xl"
        // Razorpay's iframe counts as "outside", so without this the sheet
        // would dismiss itself the moment the guest touched the gateway.
        onInteractOutside={(e) => {
          if (stage === "paying" || stage === "verifying") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (stage === "verifying") e.preventDefault();
        }}
      >
        {stage === "done" ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-14 w-14 text-brand" />
            <div>
              <SheetTitle className="text-xl">Payment received</SheetTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                We&apos;ve held {checkIn} → {checkOut} for you. Chandra is reviewing
                your details now and you&apos;ll get a WhatsApp the moment it&apos;s
                confirmed — usually within a few hours.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button asChild variant="outline">
                <a href={callHref}>
                  <Phone className="mr-2 h-4 w-4" /> Call us
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={waLink} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                </a>
              </Button>
            </div>
            <Button asChild variant="brand" className="w-full">
              <Link href="/my-bookings">View my booking</Link>
            </Button>
          </div>
        ) : (
          <>
            <div>
              <SheetTitle className="text-xl">Book with us</SheetTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {propertyName} · {nights} night{nights === 1 ? "" : "s"} ·{" "}
                {guests} guest{guests === 1 ? "" : "s"}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="reason">Reason for visit</Label>
              <Textarea
                id="reason"
                rows={2}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Work trip, family visit, exams, relocation…"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="contactPhone">Contact number</Label>
              <Input
                id="contactPhone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>

            <div className="space-y-3">
              <div>
                <Label>Government ID for each guest</Label>
                <p className="text-xs text-muted-foreground">
                  Aadhaar, passport or driving licence — JPG, PNG or PDF, up to 4 MB.
                  Stored privately and only ever seen by your host.
                </p>
              </div>

              {names.map((name, i) => {
                const doc = docs[i];
                return (
                  <div key={i} className="rounded-xl border p-3">
                    <Input
                      value={name}
                      placeholder={`Guest ${i + 1} full name`}
                      maxLength={120}
                      onChange={(e) =>
                        setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))
                      }
                    />
                    {doc ? (
                      <div className="mt-2 flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-brand" />
                        <span className="min-w-0 flex-1 truncate">{doc.docName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {prettySize(doc.docSize)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeDoc(i)}
                          aria-label={`Remove guest ${i + 1}'s ID`}
                          className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          ref={(el) => {
                            fileInputs.current[i] = el;
                          }}
                          type="file"
                          accept={ACCEPT}
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadDoc(i, file);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-2 w-full"
                          disabled={uploading !== null || !bookingId}
                          onClick={() => fileInputs.current[i]?.click()}
                        >
                          {uploading === i ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="mr-2 h-4 w-4" />
                          )}
                          {uploading === i ? "Uploading…" : "Upload ID"}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}

            <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 pb-1 pt-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-lg font-semibold">{formatINR(total)}</span>
              </div>
              <Button
                variant="brand"
                size="lg"
                className="w-full"
                disabled={!ready || stage !== "form" || starting}
                onClick={pay}
              >
                {stage === "verifying" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming your payment…
                  </>
                ) : stage === "paying" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening payment…
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" /> Pay {formatINR(total)}
                  </>
                )}
              </Button>
              {stage === "paying" && (
                // Sits behind the gateway when it opens normally, so the guest
                // only ever sees this if the payment window failed to appear.
                <button
                  type="button"
                  onClick={abandonPayment}
                  className="mt-2 w-full text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Payment window didn&apos;t open? Tap to go back
                </button>
              )}
              {stage === "form" && !ready && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {!allNamesIn || !allDocsIn
                    ? "Add every guest's name and ID to continue"
                    : "Add your reason for visit and a contact number"}
                </p>
              )}
              <a
                href={waHelpLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center justify-center gap-2 rounded-full py-2 text-xs font-medium text-[#128C7E] transition hover:bg-[#25D366]/10"
              >
                <MessageCircle className="h-4 w-4" />
                Need help? Chat with us on WhatsApp
              </a>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
