"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/date-range-picker";

export type OfflineBookingEditData = {
  id: string;
  listingId: string;
  guestName: string;
  guestPhone: string | null;
  guests: number;
  checkIn: string; // ISO
  checkOut: string; // ISO
  totalPrice: number; // paise
  amountPaid: number; // paise
  source: string;
  note: string | null;
};

type ConflictRange = { startDate: string; endDate: string; kind: string; guestName?: string | null };

function isoToYmd(iso: string) {
  return iso.slice(0, 10);
}
function paiseToRupees(p: number) {
  return p ? String(Math.round(p) / 100) : "";
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function kindLabel(kind: string) {
  if (kind === "BOOKING") return "Booked";
  if (kind === "ICAL") return "Imported (Airbnb/other)";
  return "Blocked";
}

export function OfflineBookingEdit({ booking }: { booking: OfflineBookingEditData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ConflictRange[] | null>(null);
  const [blockedRanges, setBlockedRanges] = useState<{ startDate: string; endDate: string }[]>([]);

  const [form, setForm] = useState({
    guestName: booking.guestName,
    guestPhone: booking.guestPhone ?? "",
    guests: booking.guests,
    checkIn: isoToYmd(booking.checkIn),
    checkOut: isoToYmd(booking.checkOut),
    totalPrice: paiseToRupees(booking.totalPrice),
    amountPaid: paiseToRupees(booking.amountPaid),
    source: booking.source,
    note: booking.note ?? "",
  });

  // Fetch the flat's blocks (minus THIS booking's own range) so the picker shows
  // real conflicts but still lets you keep or move the dates.
  useEffect(() => {
    if (!open) return;
    const selfStart = isoToYmd(booking.checkIn);
    const selfEnd = isoToYmd(booking.checkOut);
    fetch(`/api/listings/${booking.listingId}/availability`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((d) => {
        const blocks: { startDate: string; endDate: string }[] = Array.isArray(d.blocks) ? d.blocks : [];
        setBlockedRanges(
          blocks.filter((b) => !(isoToYmd(b.startDate) === selfStart && isoToYmd(b.endDate) === selfEnd))
        );
      })
      .catch(() => setBlockedRanges([]));
  }, [open, booking.listingId, booking.checkIn, booking.checkOut]);

  function set(name: string, value: string | number) {
    setForm((c) => ({ ...c, [name]: value }));
    setConflicts(null);
  }

  async function submit(override: boolean) {
    setError("");
    if (!form.checkIn || !form.checkOut) {
      setError("Select check-in and check-out dates.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/offline-bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: form.guestName,
          guestPhone: form.guestPhone.trim() || null,
          guests: Number(form.guests) || 1,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          totalPrice: Number(form.totalPrice || 0),
          amountPaid: Number(form.amountPaid || 0),
          source: form.source,
          note: form.note.trim() || null,
          override,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.conflict) {
        setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not save changes.");
        return;
      }
      setOpen(false);
      setConflicts(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
    );
  }

  return (
    <div className="mt-3 w-full space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Guest name</Label>
          <Input value={form.guestName} onChange={(e) => set("guestName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Guest phone</Label>
          <Input value={form.guestPhone} onChange={(e) => set("guestPhone", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Guests</Label>
          <Input type="number" min={1} value={form.guests || ""} onChange={(e) => set("guests", e.target.value === "" ? 0 : Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>Source</Label>
          <Select value={form.source} onValueChange={(v) => set("source", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OFFLINE">Offline / walk-in</SelectItem>
              <SelectItem value="AIRBNB">Airbnb</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label>Dates</Label>
          <DateRangePicker
            variant="card"
            checkIn={form.checkIn}
            checkOut={form.checkOut}
            blockedRanges={blockedRanges}
            allowBlocked
            onChange={(checkIn, checkOut) => { setForm((c) => ({ ...c, checkIn, checkOut })); setConflicts(null); }}
          />
        </div>
        <div className="space-y-1">
          <Label>Total price (₹)</Label>
          <Input type="number" min={0} step="0.01" value={form.totalPrice} onChange={(e) => set("totalPrice", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Amount paid (₹)</Label>
          <Input type="number" min={0} step="0.01" value={form.amountPaid} onChange={(e) => set("amountPaid", e.target.value)} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label>Note</Label>
          <Textarea value={form.note} onChange={(e) => set("note", e.target.value)} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {conflicts && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">The new dates overlap an existing block</p>
          {conflicts.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c, i) => (
                <li key={i}>{fmtDay(c.startDate)} → {fmtDay(c.endDate)} · {kindLabel(c.kind)}{c.guestName ? ` — ${c.guestName}` : ""}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="destructive" onClick={() => submit(true)} disabled={busy}>
              {busy ? "Saving…" : "Override & save"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConflicts(null)} disabled={busy}>Back</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => submit(false)} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(false); setConflicts(null); setError(""); }} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
