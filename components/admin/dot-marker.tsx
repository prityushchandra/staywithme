"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DayStatus } from "@/lib/dots";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const STATUS_NOTE: Record<Exclude<DayStatus, "open">, string> = {
  sold: "Booked",
  offMarket: "You blocked it",
  upcoming: "Still to come",
  preLive: "Not live yet",
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
  /** day of month → flats that sat empty that day */
  const [dots, setDots] = useState<Map<number, Set<string>>>(new Map());
  // Mirrors `dots` so a burst of ticks in one modal can't build on a stale map.
  const dotsRef = useRef(dots);
  const applyDots = (next: Map<number, Set<string>>) => {
    dotsRef.current = next;
    setDots(next);
  };
  const [statuses, setStatuses] = useState<Record<string, DayStatus[]>>({});
  const [modalDay, setModalDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/admin/dot-days?month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const byDay = new Map<number, Set<string>>();
        for (const [id, days] of Object.entries(data.marked ?? {})) {
          for (const d of (days as number[]) ?? []) {
            const set = byDay.get(d) ?? new Set<string>();
            set.add(id);
            byDay.set(d, set);
          }
        }
        setDots(byDay);
        dotsRef.current = byDay;
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

  const statusOf = (listingId: string, day: number): DayStatus =>
    statuses[listingId]?.[day - 1] ?? "upcoming";

  const totalDots = [...dots.values()].reduce((s, set) => s + set.size, 0);

  /** Flats that were on sale that day and never earned — the only ones tickable. */
  const openOn = (day: number) => listings.filter((l) => statusOf(l.id, day) === "open");

  const everyOpen = () => {
    const next = new Map<number, Set<string>>();
    for (let d = 1; d <= daysInMonth; d++) {
      const open = openOn(d);
      if (open.length) next.set(d, new Set(open.map((l) => l.id)));
    }
    return next;
  };
  const unmarkedOpen = (() => {
    let n = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const have = dots.get(d);
      for (const l of openOn(d)) if (!have?.has(l.id)) n++;
    }
    return n;
  })();

  async function persist(next: Map<number, Set<string>>) {
    applyDots(next);
    setError("");
    setSaving(true);
    try {
      const daysByListing: Record<string, number[]> = {};
      for (const l of listings) daysByListing[l.id] = [];
      for (const [day, ids] of next) for (const id of ids) daysByListing[id]?.push(day);

      const res = await fetch("/api/admin/dot-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, daysByListing }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save — your last change is not stored.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not save — your last change is not stored.");
    } finally {
      setSaving(false);
    }
  }

  function toggleFlat(day: number, listingId: string) {
    const next = new Map(dotsRef.current);
    const set = new Set(next.get(day) ?? []);
    if (set.has(listingId)) set.delete(listingId);
    else set.add(listingId);
    if (set.size) next.set(day, set);
    else next.delete(day);
    applyDots(next);
  }

  const modalSet = modalDay != null ? dots.get(modalDay) ?? new Set<string>() : new Set<string>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mark dot days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-1">
            <Label htmlFor="dotMonth">Month</Label>
            <Input id="dotMonth" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>

          <div className="rounded-xl border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Tap a day, then tick the flats that sat <span className="text-amber-600">empty</span>.
              </p>
              {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                  const count = dots.get(day)?.size ?? 0;
                  const open = openOn(day).length;
                  const intensity =
                    count > 0 && listings.length ? 0.3 + 0.7 * Math.min(1, count / listings.length) : 0;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setModalDay(day)}
                      disabled={listings.length === 0}
                      title={
                        count > 0
                          ? `${count} flat${count > 1 ? "s" : ""} empty`
                          : open > 0
                            ? `${open} flat${open > 1 ? "s" : ""} went unbooked`
                            : "Nothing lost"
                      }
                      style={
                        count > 0
                          ? {
                              backgroundColor: `rgba(245,158,11,${intensity})`,
                              color: "#fff",
                              borderColor: "rgba(245,158,11,0.7)",
                            }
                          : undefined
                      }
                      className={cn(
                        "relative flex aspect-square items-center justify-center rounded-md border text-sm transition-colors disabled:opacity-40",
                        count === 0 && open > 0 && "border-dashed border-amber-400 hover:bg-amber-50",
                        count === 0 && open === 0 && "text-muted-foreground/50 hover:border-foreground"
                      )}
                    >
                      <span>{day}</span>
                      {count > 0 && (
                        <span className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1 text-[9px] font-bold text-amber-600">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                The small number shows how many flats sat empty that day. Dashed days had a flat go
                unbooked but aren&apos;t marked yet.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{totalDots}</span> dot
              {totalDots === 1 ? "" : "s"} in {monthLabel(month)}
            </span>
            {unmarkedOpen > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => persist(everyOpen())} disabled={saving}>
                Mark all {unmarkedOpen} unbooked
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {modalDay != null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !saving && setModalDay(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border bg-background p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">
                {monthLabel(month)} {modalDay}
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setModalDay(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Tick each flat that stayed empty on this day.
            </p>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {listings.map((l) => {
                const status = statusOf(l.id, modalDay);
                const checked = modalSet.has(l.id);
                const canTick = status === "open";
                return (
                  <li key={l.id}>
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-2.5 text-sm",
                        canTick ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed opacity-60"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canTick}
                        onChange={() => toggleFlat(modalDay, l.id)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span className={cn("flex-1", checked && "font-medium text-amber-600")}>{l.label}</span>
                      {!canTick && (
                        <span className="text-[11px] text-muted-foreground">
                          {STATUS_NOTE[status as Exclude<DayStatus, "open">]}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {modalSet.size} of {listings.length} empty
              </span>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={async () => {
                  await persist(new Map(dotsRef.current));
                  setModalDay(null);
                }}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
