"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, MessageCircle, Phone, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/pricing";

// One paid-but-unapproved online booking, with everything the admin needs to
// decide: who is coming, why, what they paid, and their actual ID documents.
// Rejecting is deliberately two taps — it takes money without refunding it.

export type OnlineBookingCard = {
  id: string;
  listingTitle: string;
  guestName: string;
  guestPhone: string | null;
  contactPhone: string | null;
  checkIn: string;
  checkOut: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number;
  guests: number;
  totalAmount: number;
  amountPaid: number;
  reasonForVisit: string | null;
  adminNote: string | null;
  paidAt: string | null;
  razorpayPaymentId: string | null;
  docs: { id: string; name: string; docName: string }[];
};

function digits(phone: string | null) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? d : null;
}

export function OnlineBookingReview({ booking: b }: { booking: OnlineBookingCard }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Action failed.");
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setBusy(null);
    }
  }

  const phone = digits(b.contactPhone ?? b.guestPhone);
  const wa = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(
        `Hi ${b.guestName}, about your booking for ${b.listingTitle} (${b.checkIn} to ${b.checkOut}) — `
      )}`
    : null;

  return (
    <div className="rounded-xl border border-amber-400/60 bg-amber-50/40 p-4 dark:bg-amber-500/5">
      {b.adminNote && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {b.adminNote}
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{b.guestName}</span>
            <Badge variant="warning">Awaiting approval</Badge>
            <Badge variant="secondary">Paid online</Badge>
            <span className="font-mono text-xs text-muted-foreground">#{b.id.slice(-6)}</span>
          </div>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Flat</dt>
            <dd className="font-medium">{b.listingTitle}</dd>
            <dt className="text-muted-foreground">Check-in</dt>
            <dd>
              {b.checkIn}
              {b.checkInTime ? `, ${b.checkInTime}` : ""}
            </dd>
            <dt className="text-muted-foreground">Check-out</dt>
            <dd>
              {b.checkOut}
              {b.checkOutTime ? `, ${b.checkOutTime}` : ""} · {b.nights} night
              {b.nights > 1 ? "s" : ""} · {b.guests} guest{b.guests > 1 ? "s" : ""}
            </dd>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="font-medium text-green-700 dark:text-green-400">
              {formatINR(b.amountPaid)}
              {b.amountPaid !== b.totalAmount && ` of ${formatINR(b.totalAmount)}`}
              {b.razorpayPaymentId && (
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {b.razorpayPaymentId}
                </span>
              )}
            </dd>
            {b.contactPhone && (
              <>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{b.contactPhone}</dd>
              </>
            )}
            {b.reasonForVisit && (
              <>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="whitespace-pre-wrap">{b.reasonForVisit}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            {b.docs.map((d) => (
              <a
                key={d.id}
                href={`/api/admin/bookings/docs/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium transition hover:border-foreground"
                title={d.docName}
              >
                <FileText className="h-3.5 w-3.5" />
                {d.name}
              </a>
            ))}
            {b.docs.length === 0 && (
              <span className="text-xs text-destructive">No IDs attached.</span>
            )}
          </div>

          {phone && (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`tel:+${phone}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
              >
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
            </div>
          )}
        </div>

        <div className="w-full space-y-2 sm:w-64">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note to the guest (optional)"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => act("approve")}
              disabled={busy !== null}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-700 active:scale-[0.97] disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {busy === "approve" ? "Accepting…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => (confirmReject ? act("reject") : setConfirmReject(true))}
              disabled={busy !== null}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:border-destructive hover:text-destructive active:scale-[0.97] disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              {busy === "reject" ? "Cancelling…" : confirmReject ? "Sure?" : "Cancel"}
            </button>
          </div>
          {confirmReject && busy === null && (
            <p className="text-xs text-muted-foreground">
              Cancelling releases the dates and does not refund. Issue any refund
              from the Razorpay dashboard.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
