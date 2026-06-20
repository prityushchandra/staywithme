"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/date-range-picker";
import { AvailabilityCalendar, type SerializedBlock } from "@/components/availability-calendar";

interface Block extends SerializedBlock {
  id: string;
  kind: string;
  guestName: string | null;
  guests: number | null;
  note: string | null;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function AvailabilityManager({
  listingId,
  blocks,
}: {
  listingId: string;
  blocks: Block[];
}) {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const blockedRanges = blocks.map((b) => ({
    startDate: b.startDate,
    endDate: b.endDate,
  }));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!checkIn || !checkOut) {
      setError("Pick the dates you want to block.");
      return;
    }
    setError("");
    setBusy(true);
    const res = await fetch(`/api/listings/${listingId}/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: checkIn,
        endDate: checkOut,
        kind: "MANUAL",
        note: note || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not block these dates.");
      return;
    }
    setCheckIn("");
    setCheckOut("");
    setNote("");
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/listings/${listingId}/availability?blockId=${id}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <form onSubmit={add} className="space-y-4 rounded-xl border p-5">
          <h2 className="font-semibold">Block dates</h2>
          <p className="text-sm text-muted-foreground">
            Pick the dates you want to keep unavailable, add an optional note, and
            block them. Already-blocked dates are greyed out in the calendar.
          </p>

          <DateRangePicker
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(ci, co) => {
              setCheckIn(ci);
              setCheckOut(co);
            }}
            variant="card"
            blockedRanges={blockedRanges}
          />

          <div className="space-y-1">
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Booked, maintenance, personal use"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="brand" disabled={busy}>
            <CalendarPlus className="h-4 w-4" /> {busy ? "Blocking…" : "Block these dates"}
          </Button>
        </form>

        <div className="rounded-xl border p-5">
          <h2 className="mb-3 font-semibold">Blocked &amp; booked dates</h2>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocked dates yet.</p>
          ) : (
            <ul className="space-y-2">
              {blocks.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={b.kind === "BOOKING" ? "default" : "secondary"}>
                        {b.kind === "BOOKING" ? "Booking" : "Blocked"}
                      </Badge>
                      <span className="font-medium">
                        {fmt(b.startDate)} → {fmt(b.endDate)}
                      </span>
                    </div>
                    {(b.guestName || b.note) && (
                      <p className="mt-0.5 truncate text-muted-foreground">
                        {[b.guestName, b.guests ? `${b.guests} guests` : null, b.note]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(b.id)}
                    className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Remove block"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <h2 className="mb-3 font-semibold">Calendar preview</h2>
        <AvailabilityCalendar blocks={blocks} />
      </div>
    </div>
  );
}
