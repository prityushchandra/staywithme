"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type OfflineBookingListing = { id: string; label: string };

type Success = { receiptNumber: string; receiptUrl: string };

export function OfflineBookingForm({ listings }: { listings: OfflineBookingListing[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [form, setForm] = useState({
    listingId: listings[0]?.id ?? "",
    guestName: "",
    guestPhone: "",
    guests: 1,
    checkIn: "",
    checkOut: "",
    totalPrice: "",
    amountPaid: "0",
    source: "OFFLINE",
    note: "",
  });

  function setField(name: string, value: string | number) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess(null);
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
      setForm((current) => ({ ...current, guestName: "", guestPhone: "", guests: 1, checkIn: "", checkOut: "", totalPrice: "", amountPaid: "0", note: "" }));
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
          <div className="space-y-2">
            <Label htmlFor="checkIn">Check-in</Label>
            <Input id="checkIn" type="date" value={form.checkIn} onChange={(e) => setField("checkIn", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkOut">Check-out</Label>
            <Input id="checkOut" type="date" value={form.checkOut} onChange={(e) => setField("checkOut", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalPrice">Total price (₹)</Label>
            <Input id="totalPrice" type="number" min={0} step="0.01" value={form.totalPrice} onChange={(e) => setField("totalPrice", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amountPaid">Amount paid (₹)</Label>
            <Input id="amountPaid" type="number" min={0} step="0.01" value={form.amountPaid} onChange={(e) => setField("amountPaid", e.target.value)} />
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
            <Button asChild size="sm"><a href={success.receiptUrl} target="_blank" rel="noreferrer">Open receipt</a></Button>
            <Button type="button" size="sm" variant="outline" onClick={copyReceiptLink}>Copy receipt link</Button>
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

  if (status === "CANCELLED") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel"}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
