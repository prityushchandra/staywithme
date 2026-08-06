"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/date-range-picker";

export type OfflineBookingListing = { id: string; label: string };

type Success = { receiptNumber: string; receiptUrl: string };

export function OfflineBookingForm({ listings }: { listings: OfflineBookingListing[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [blockedRanges, setBlockedRanges] = useState<{ startDate: string; endDate: string }[]>([]);
  const [blocksVersion, setBlocksVersion] = useState(0);
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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess(null);

    if (!form.checkIn || !form.checkOut) {
      setError("Select check-in and check-out dates.");
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/offline-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          guests: Number(form.guests),
          totalPrice: Number(form.totalPrice),
          amountPaid: Number(form.amountPaid || 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not record booking.");
        setSubmitting(false);
        return;
      }
      setSuccess({ receiptNumber: data.receiptNumber, receiptUrl: data.receiptUrl });
      setForm((current) => ({ ...current, guestName: "", guestPhone: "", guests: 1, checkIn: "", checkOut: "", totalPrice: "", amountPaid: "", note: "" }));
      setBlocksVersion((v) => v + 1);
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
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
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Listing</Label>
            <Select value={form.listingId} onValueChange={(value) => setField("listingId", value)}>
              <SelectTrigger><SelectValue placeholder="Choose listing" /></SelectTrigger>
              <SelectContent>
                {listings.map((listing) => <SelectItem key={listing.id} value={listing.id}>{listing.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="guestName">Guest name</Label>
            <Input id="guestName" value={form.guestName} onChange={(e) => setField("guestName", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guestPhone">Guest phone</Label>
            <Input id="guestPhone" value={form.guestPhone} onChange={(e) => setField("guestPhone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guests">Guests</Label>
            <Input id="guests" type="number" min={1} value={form.guests} onChange={(e) => setField("guests", Number(e.target.value))} required />
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
              onChange={(checkIn, checkOut) =>
                setForm((c) => ({ ...c, checkIn, checkOut }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Booked dates are greyed out. Pick a check-in, then a check-out.
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
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting || listings.length === 0}>{submitting ? "Recording…" : "Record booking"}</Button>
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
