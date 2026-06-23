"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CalendarDays, Loader2, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CalendarSyncCard({
  listingId,
  initialUrl,
  initialSyncedAt,
  initialError,
}: {
  listingId: string;
  initialUrl: string | null;
  initialSyncedAt: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [syncedAt, setSyncedAt] = useState(initialSyncedAt);
  const [error, setError] = useState(initialError ?? "");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy("save");
    try {
      const res = await fetch(`/api/listings/${listingId}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't sync that calendar.");
        return;
      }
      setSyncedAt(data.syncedAt ?? new Date().toISOString());
      setOk(`Synced — imported ${data.count} blocked ${data.count === 1 ? "range" : "ranges"}.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError("");
    setOk("");
    setBusy("remove");
    try {
      const res = await fetch(`/api/listings/${listingId}/calendar`, { method: "DELETE" });
      if (res.ok) {
        setUrl("");
        setSyncedAt(null);
        setOk("Calendar link removed.");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="h-5 w-5 text-brand" /> Sync your Airbnb calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste your Airbnb listing&apos;s calendar export link (.ics). We&apos;ll
          import its booked &amp; blocked dates so they show as unavailable here
          too — no double bookings. Keep your Airbnb calendar up to date and this
          stays in sync (auto-refreshed daily; or hit Sync now).
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Where do I find this link?
          </summary>
          <p className="mt-1">
            Airbnb → your listing → Calendar → Availability → Connect calendars →
            Export calendar → copy the link.
          </p>
        </details>

        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="icalUrl">Airbnb calendar link</Label>
            <Input
              id="icalUrl"
              type="url"
              inputMode="url"
              placeholder="https://www.airbnb.com/calendar/ical/….ics?s=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {ok && (
            <p className="flex items-center gap-1.5 text-sm text-green-700">
              <Check className="h-4 w-4" /> {ok}
            </p>
          )}
          {syncedAt && !ok && (
            <p className="text-xs text-muted-foreground">
              Last synced {new Date(syncedAt).toLocaleString()}.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="brand" size="sm" disabled={busy !== null}>
              {busy === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {initialUrl ? "Sync now" : "Save & sync"}
            </Button>
            {initialUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={remove}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
