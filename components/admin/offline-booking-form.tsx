"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  applyUploadedGuests, GuestUploadErrors, OfflineGuestFields,
  offlineGuestPayload, uploadOfflineGuestFiles,
  type GuestUpload, type GuestUploadFailure, type OfflineGuestDraft,
} from "@/components/admin/offline-guest-fields";

export type OfflineBookingListing = { id: string; label: string };

type Success = { id: string; receiptNumber: string; receiptUrl: string };
type ConflictRange = { startDate: string; endDate: string; kind: string; guestName?: string | null };

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function kindLabel(kind: string) {
  if (kind === "BOOKING") return "Booked";
  if (kind === "ICAL") return "Imported (Airbnb/other)";
  return "Blocked";
}

export function OfflineBookingForm({ listings }: { listings: OfflineBookingListing[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRange[] | null>(null);
  const [blockedRanges, setBlockedRanges] = useState<{ startDate: string; endDate: string }[]>([]);
  const [blocksVersion, setBlocksVersion] = useState(0);
  const [guestDrafts, setGuestDrafts] = useState<OfflineGuestDraft[]>([]);
  const [uploadFailures, setUploadFailures] = useState<GuestUploadFailure[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [form, setForm] = useState({
    listingId: listings[0]?.id ?? "",
    guestName: "",
    guestPhone: "",
    guests: 1,
    checkIn: "",
    checkOut: "",
    totalPrice: "",
    amountPaid: "",
    source: "OFFLINE",
    note: "",
  });

  // Load the selected flat's booked/blocked dates so the picker greys them out
  // (same availability the guest-facing calendar shows).
  useEffect(() => {
    if (!form.listingId) {
      setBlockedRanges([]);
      return;
    }
    let active = true;
    fetch(`/api/listings/${form.listingId}/availability`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((d) => {
        if (active) setBlockedRanges(Array.isArray(d.blocks) ? d.blocks : []);
      })
      .catch(() => {
        if (active) setBlockedRanges([]);
      });
    return () => {
      active = false;
    };
  }, [form.listingId, blocksVersion]);

  function setField(name: string, value: string | number) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setForm((current) => ({ ...current, guestName: "", guestPhone: "", guests: 1, checkIn: "", checkOut: "", totalPrice: "", amountPaid: "", note: "" }));
    setGuestDrafts([]);
    setUploadFailures([]);
    setError("");
  }

  async function finishUploads(bookingId: string, uploads: readonly GuestUpload[]) {
    const result = await uploadOfflineGuestFiles(bookingId, uploads, (guest, current, total) => {
      setUploadProgress(`Uploading Guest ${guest}'s ID (${current} of ${total})...`);
    });
    setGuestDrafts((current) => applyUploadedGuests(current, result.saved));
    setUploadFailures(result.failed);
    if (result.failed.length === 0) resetForm();
    router.refresh();
  }

  async function retryUploads() {
    if (!success || submitting) return;
    setSubmitting(true);
    try {
      await finishUploads(success.id, uploadFailures.map(({ upload }) => upload));
    } finally {
      setUploadProgress("");
      setSubmitting(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConflicts(null);
    await doSubmit(false);
  }

  async function doSubmit(override: boolean) {
    if (submitting || uploadFailures.length > 0) return;
    setError("");
    setSuccess(null);

    if (!form.checkIn || !form.checkOut) {
      setError("Select check-in and check-out dates.");
      return;
    }
    let guests: ReturnType<typeof offlineGuestPayload>;
    try {
      guests = offlineGuestPayload(guestDrafts, Number(form.guests), form.guestName);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check the guest details.");
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/offline-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          guests: Number(form.guests) || 1,
          totalPrice: Number(form.totalPrice),
          amountPaid: Number(form.amountPaid || 0),
          override,
          guestDetails: guests.guestDetails,
        }),
      });
      const data = await res.json().catch(() => ({}));
      // Dates already blocked → surface an override prompt instead of an error.
      if (res.status === 409 && data.conflict) {
        setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not record booking.");
        return;
      }
      setSuccess({ id: data.id, receiptNumber: data.receiptNumber, receiptUrl: data.receiptUrl });
      setConflicts(null);
      setBlocksVersion((v) => v + 1);
      await finishUploads(data.id, guests.uploads);
    } catch {
      setError("Something went wrong.");
    } finally {
      setUploadProgress("");
      setSubmitting(false);
    }
  }

  async function copyReceiptLink() {
    if (!success) return;
    await navigator.clipboard.writeText(`${window.location.origin}${success.receiptUrl}`);
  }

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={submitting || uploadFailures.length > 0} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Listing</Label>
            <Select value={form.listingId} onValueChange={(value) => { setField("listingId", value); setConflicts(null); }}>
              <SelectTrigger><SelectValue placeholder="Choose listing" /></SelectTrigger>
              <SelectContent>
                {listings.map((listing) => <SelectItem key={listing.id} value={listing.id}>{listing.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="guestName">Primary guest name</Label>
            <Input id="guestName" maxLength={120} value={form.guestName} onChange={(e) => setField("guestName", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guestPhone">Guest phone</Label>
            <Input id="guestPhone" value={form.guestPhone} onChange={(e) => setField("guestPhone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guests">Guests</Label>
            <Input id="guests" type="number" min={1} max={50} value={form.guests || ""} onChange={(e) => setField("guests", e.target.value === "" ? 0 : Number(e.target.value))} required />
          </div>
          <div className="space-y-2">
            <Label>Source</Label>
            <Select value={form.source} onValueChange={(value) => setField("source", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OFFLINE">Offline / walk-in</SelectItem>
                <SelectItem value="AIRBNB">Airbnb</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Dates</Label>
            <DateRangePicker
              variant="card"
              checkIn={form.checkIn}
              checkOut={form.checkOut}
              blockedRanges={blockedRanges}
              allowBlocked
              allowPast
              onChange={(checkIn, checkOut) => {
                setForm((c) => ({ ...c, checkIn, checkOut }));
                setConflicts(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Available dates book straight away. Already-booked dates show struck-through in
              amber — you can still pick them and you&apos;ll be asked to confirm an override. Past
              dates are allowed too (for recording a stay that already happened).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalPrice">Total price (₹)</Label>
            <Input id="totalPrice" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={form.totalPrice} onChange={(e) => setField("totalPrice", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amountPaid">Amount paid (₹)</Label>
            <Input id="amountPaid" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={form.amountPaid} onChange={(e) => setField("amountPaid", e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" value={form.note} onChange={(e) => setField("note", e.target.value)} placeholder="Optional internal note" />
          </div>
        </fieldset>

        <OfflineGuestFields
          drafts={guestDrafts}
          count={Number(form.guests)}
          primaryName={form.guestName}
          onChange={setGuestDrafts}
          disabled={submitting || uploadFailures.length > 0}
        />

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {uploadProgress && <p role="status" className="text-sm text-muted-foreground">{uploadProgress}</p>}
        <GuestUploadErrors
          failed={uploadFailures}
          busy={submitting}
          onRetry={() => void retryUploads()}
          onContinue={resetForm}
        />

        {conflicts && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">These dates are already blocked</p>
            {conflicts.length > 0 && (
              <ul className="mt-2 space-y-1">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {fmtDay(c.startDate)} → {fmtDay(c.endDate)} · {kindLabel(c.kind)}
                    {c.guestName ? ` — ${c.guestName}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2">
              Record this booking anyway? The existing block stays in place; your new booking
              will overlap it and its dates will be blocked.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={() => doSubmit(true)} disabled={submitting}>
                {submitting ? "Booking…" : "Override & book anyway"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConflicts(null)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <Button type="submit" disabled={submitting || uploadFailures.length > 0 || listings.length === 0}>
          {uploadFailures.length > 0 ? "Booking already recorded" : submitting ? uploadProgress ? "Uploading IDs..." : "Recording…" : "Record booking"}
        </Button>
      </form>

      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">Booking recorded · {success.receiptNumber}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={`${success.receiptUrl}?download=1`} download>Download receipt</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={success.receiptUrl} target="_blank" rel="noreferrer">Open</a>
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={copyReceiptLink}>Copy link</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function OfflineBookingActions({ bookingId, status }: { bookingId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/offline-bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not cancel booking.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Permanently delete this cancelled booking and its receipt? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/offline-bookings/${bookingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not delete booking.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setBusy(false);
    }
  }

  if (status === "CANCELLED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel"}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
