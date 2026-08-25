"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DayStatus } from "@/lib/dots";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const STATUS_LABEL: Record<DayStatus, string> = {
  sold: "Booked",
  offMarket: "You blocked it",
  upcoming: "Still to come",
  open: "Was open, never booked",
  preLive: "Before the flat existed",
};

const STATUS_HINT: Record<DayStatus, string> = {
  sold: "Earned money — not a lost day.",
  offMarket: "You took it off the market, so it was never for sale.",
  upcoming: "The day hasn't ended yet.",
  open: "Nobody booked it and the day is gone.",
  preLive: "The flat wasn't on the platform yet.",
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DotMarker({
  initialMonth,
  listings,
}: {
  initialMonth: string;
  listings: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [marked, setMarked] = useState<Map<string, Set<number>>>(new Map());
  const [statuses, setStatuses] = useState<Record<string, DayStatus[]>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    setLoading(true);
    setSaved(false);
    fetch(`/api/admin/dot-days?month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, Set<number>>();
        for (const [id, days] of Object.entries(data.marked ?? {})) {
          if (Array.isArray(days) && days.length) map.set(id, new Set(days as number[]));
        }
        setMarked(map);
        setStatuses(data.statuses ?? {});
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this month.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = yy && mm ? new Date(Date.UTC(yy, mm, 0)).getUTCDate() : 30;
  const firstWeekday = yy && mm ? new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() : 0;

  const dayStatus = statuses[listingId] ?? [];
  const flatMarks = marked.get(listingId) ?? new Set<number>();
  const totalDots = [...marked.values()].reduce((s, set) => s + set.size, 0);
  const openDays = dayStatus
    .map((s, i) => (s === "open" ? i + 1 : 0))
    .filter((d): d is number => d > 0);
  const unmarkedOpen = openDays.filter((d) => !flatMarks.has(d));

  function setFlatDays(next: Set<number>) {
    setSaved(false);
    setMarked((prev) => {
      const m = new Map(prev);
      if (next.size === 0) m.delete(listingId);
      else m.set(listingId, next);
      return m;
    });
  }

  function toggleDay(day: number) {
    // Only a day that was actually on sale and has ended can be a dot.
    if (dayStatus[day - 1] !== "open") return;
    const next = new Set(flatMarks);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setFlatDays(next);
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      const daysByListing: Record<string, number[]> = {};
      for (const l of listings) daysByListing[l.id] = [...(marked.get(l.id) ?? [])];
      const res = await fetch("/api/admin/dot-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, daysByListing }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Mark dot days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dotFlat">Flat</Label>
            <select
              id="dotFlat"
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            >
              {listings.length === 0 && <option value="">No flats yet</option>}
              {listings.map((l) => {
                const n = marked.get(l.id)?.size ?? 0;
                return (
                  <option key={l.id} value={l.id}>
                    {l.label}
                    {n > 0 ? ` · ${n} dot${n > 1 ? "s" : ""}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dotMonth">Month</Label>
            <Input id="dotMonth" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>

        <div className="rounded-xl border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Tap the days this flat sat <span className="text-amber-600">empty</span>.
            </p>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {WEEKDAYS.map((d, i) => (
                <div key={`${d}-${i}`} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const status = dayStatus[i] ?? "upcoming";
                const isDot = flatMarks.has(day);
                const selectable = status === "open";
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    disabled={!selectable || !listingId}
                    title={`${STATUS_LABEL[status]} — ${STATUS_HINT[status]}`}
                    className={cn(
                      "relative flex aspect-square items-center justify-center rounded-md border text-sm transition-colors",
                      isDot && "border-amber-500 bg-amber-500 font-semibold text-white",
                      !isDot && selectable && "border-dashed border-amber-400 text-foreground hover:bg-amber-50",
                      status === "sold" && "border-transparent bg-emerald-50 text-emerald-700",
                      status === "offMarket" && "border-transparent bg-muted text-muted-foreground line-through",
                      (status === "upcoming" || status === "preLive") && "border-transparent text-muted-foreground/40"
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
                Dot
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-amber-400" />
                Was open — tap to mark
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100" />
                Booked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted" />
                Blocked / upcoming
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">
            {flatMarks.size} dot{flatMarks.size === 1 ? "" : "s"} on this flat · {totalDots} across all flats
            in {monthLabel(month)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFlatDays(new Set([...flatMarks, ...openDays]))}
            disabled={unmarkedOpen.length === 0}
          >
            <Wand2 className="h-4 w-4" />
            Mark all {unmarkedOpen.length} open {unmarkedOpen.length === 1 ? "day" : "days"}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-green-700">Saved. The P&amp;L is updated.</p>}
        <Button type="button" variant="brand" onClick={save} disabled={busy || listings.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save {monthLabel(month)}
        </Button>
      </CardContent>
    </Card>
  );
}
