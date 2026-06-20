"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface EditorBlock {
  id: string;
  startDate: string; // ISO
  endDate: string; // ISO (exclusive)
  kind: string;
  guestName: string | null;
  guests: number | null;
  note: string | null;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayYmd() {
  return toYmd(new Date());
}
function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return toYmd(new Date(y, m - 1, d + n));
}
function fmt(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function nights(a: string | null, b: string | null) {
  if (!a || !b) return 0;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function AvailabilityEditor({
  listingId,
  blocks,
}: {
  listingId: string;
  blocks: EditorBlock[];
}) {
  const router = useRouter();
  const today = todayYmd();

  const start = new Date();
  const [view, setView] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<EditorBlock | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Map each blocked night (yyyy-mm-dd) -> its block.
  const blockByDay = useMemo(() => {
    const map = new Map<string, EditorBlock>();
    for (const b of blocks) {
      let d = b.startDate.slice(0, 10);
      const end = b.endDate.slice(0, 10);
      while (d < end) {
        map.set(d, b);
        d = addDays(d, 1);
      }
    }
    return map;
  }, [blocks]);

  function rangeHasBlocked(s: string, e: string) {
    let d = s;
    while (d < e) {
      if (blockByDay.has(d)) return true;
      d = addDays(d, 1);
    }
    return false;
  }

  function onDayClick(ymd: string) {
    if (ymd < today) return;
    setError("");
    const block = blockByDay.get(ymd);
    if (block) {
      // Tapping a blocked night selects its block to free up.
      setSelectedBlock(block);
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    setSelectedBlock(null);
    if (!selStart || (selStart && selEnd)) {
      setSelStart(ymd);
      setSelEnd(null);
      return;
    }
    if (ymd <= selStart || rangeHasBlocked(selStart, ymd)) {
      setSelStart(ymd);
      setSelEnd(null);
      return;
    }
    setSelEnd(ymd);
  }

  async function block() {
    if (!selStart || !selEnd) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/listings/${listingId}/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: selStart,
        endDate: selEnd,
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
    setSelStart(null);
    setSelEnd(null);
    setNote("");
    router.refresh();
  }

  async function unblock() {
    if (!selectedBlock) return;
    setBusy(true);
    setError("");
    const res = await fetch(
      `/api/listings/${listingId}/availability?blockId=${selectedBlock.id}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!res.ok) {
      setError("Could not free up these dates.");
      return;
    }
    setSelectedBlock(null);
    router.refresh();
  }

  function shift(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }
  const canBack =
    view.year > start.getFullYear() ||
    (view.year === start.getFullYear() && view.month > start.getMonth());

  // Tentative end while hovering an open range.
  const rangeEnd = selEnd ?? (selStart && hovered && hovered > selStart ? hovered : null);
  const n = nights(selStart, selEnd);

  return (
    <div className="rounded-2xl border p-5 sm:p-6">
      <div className="relative">
        <button
          type="button"
          onClick={() => canBack && shift(-1)}
          disabled={!canBack}
          className="absolute left-0 top-0 rounded-full p-2 hover:bg-muted disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="absolute right-0 top-0 rounded-full p-2 hover:bg-muted"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-8 sm:flex-row sm:gap-10">
          <MonthGrid
            year={view.year}
            month={view.month}
            today={today}
            selStart={selStart}
            rangeEnd={rangeEnd}
            blockByDay={blockByDay}
            selectedBlock={selectedBlock}
            onClick={onDayClick}
            onHover={setHovered}
          />
          <div className="hidden sm:block">
            <MonthGrid
              year={view.month === 11 ? view.year + 1 : view.year}
              month={(view.month + 1) % 12}
              today={today}
              selStart={selStart}
              rangeEnd={rangeEnd}
              blockByDay={blockByDay}
              selectedBlock={selectedBlock}
              onClick={onDayClick}
              onHover={setHovered}
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-5 flex flex-wrap items-center gap-4 border-t pt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border bg-background" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted" /> Blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-brand" /> Selected
        </span>
      </div>

      {/* Action panel */}
      <div className="mt-4">
        {selStart && selEnd ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              Block {fmt(selStart)} – {fmt(selEnd)}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {n} night{n > 1 ? "s" : ""}
              </span>
            </p>
            <div className="space-y-1">
              <Label htmlFor="note" className="text-xs">
                Note (optional)
              </Label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Booked, maintenance, personal use"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="button" variant="brand" disabled={busy} onClick={block}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Block these dates
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelStart(null);
                  setSelEnd(null);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        ) : selectedBlock ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              {fmt(selectedBlock.startDate.slice(0, 10))} –{" "}
              {fmt(selectedBlock.endDate.slice(0, 10))}
              <span className="font-normal text-muted-foreground"> · Blocked</span>
            </p>
            {(selectedBlock.note || selectedBlock.guestName) && (
              <p className="text-sm text-muted-foreground">
                {[selectedBlock.guestName, selectedBlock.note].filter(Boolean).join(" · ")}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="button" variant="brand" disabled={busy} onClick={unblock}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Free up these dates
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelectedBlock(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Tap open dates to block them (add an optional note), or tap a blocked
            date to free it up.
          </p>
        )}
      </div>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  today,
  selStart,
  rangeEnd,
  blockByDay,
  selectedBlock,
  onClick,
  onHover,
}: {
  year: number;
  month: number;
  today: string;
  selStart: string | null;
  rangeEnd: string | null;
  blockByDay: Map<string, EditorBlock>;
  selectedBlock: EditorBlock | null;
  onClick: (ymd: string) => void;
  onHover: (ymd: string | null) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const label = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex-1">
      <div className="mb-3 text-center text-sm font-semibold">{label}</div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const ymd = `${year}-${pad(month + 1)}-${pad(i + 1)}`;
          const isPast = ymd < today;
          const block = blockByDay.get(ymd);
          const isBlocked = !!block;
          const inSelectedBlock = !!(selectedBlock && block && block.id === selectedBlock.id);
          const isStart = selStart && ymd === selStart;
          const isEnd = rangeEnd && ymd === rangeEnd;
          const inRange = selStart && rangeEnd && ymd > selStart && ymd < rangeEnd;
          const isEndpoint = isStart || isEnd;

          return (
            <div
              key={ymd}
              className={cn(
                "aspect-square p-0.5",
                (inRange || (isEndpoint && rangeEnd)) && "bg-brand/10",
                isStart && rangeEnd && "rounded-l-full",
                isEnd && "rounded-r-full"
              )}
            >
              <button
                type="button"
                disabled={isPast}
                onClick={() => onClick(ymd)}
                onMouseEnter={() => onHover(ymd)}
                onMouseLeave={() => onHover(null)}
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-full text-sm transition-colors",
                  isPast && "cursor-default text-muted-foreground/30",
                  isEndpoint && "bg-brand font-semibold text-white",
                  inSelectedBlock && "bg-destructive/15 text-destructive ring-1 ring-destructive/40",
                  isBlocked && !inSelectedBlock && "bg-muted text-muted-foreground/60 line-through",
                  !isPast && !isBlocked && !isEndpoint && "hover:border hover:border-foreground"
                )}
              >
                {i + 1}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
