"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  initial,
}: {
  initial: {
    whatsappNumber: string;
    platformFeePercent: number;
    suggestedPriceMinRupees: number;
    suggestedPriceMaxRupees: number;
    rankWeightView: number;
    rankWeightSave: number;
    rankWeightClick: number;
    reviewsOpenToAll: boolean;
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not save settings.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-lg space-y-6">
      <div className="space-y-1">
        <Label htmlFor="wa">Platform WhatsApp number</Label>
        <Input
          id="wa"
          value={form.whatsappNumber}
          onChange={(e) => set("whatsappNumber", e.target.value)}
          placeholder="+918789194107"
        />
        <p className="text-xs text-muted-foreground">
          Every inquiry across the platform routes to this number.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fee">Platform Fee (%)</Label>
        <Input
          id="fee"
          type="number"
          min={0}
          max={100}
          value={form.platformFeePercent}
          onChange={(e) => set("platformFeePercent", Number(e.target.value) || 0)}
        />
        <p className="text-xs text-muted-foreground">
          Applied on top of every host base price, everywhere.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="min">Suggested price min (₹)</Label>
          <Input
            id="min"
            type="number"
            min={0}
            value={form.suggestedPriceMinRupees}
            onChange={(e) => set("suggestedPriceMinRupees", Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="max">Suggested price max (₹)</Label>
          <Input
            id="max"
            type="number"
            min={0}
            value={form.suggestedPriceMaxRupees}
            onChange={(e) => set("suggestedPriceMaxRupees", Number(e.target.value) || 0)}
          />
        </div>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Shown to hosts as the recommended nightly range when they set a price.
      </p>

      <div className="space-y-1">
        <Label>Ranking weights</Label>
        <p className="text-xs text-muted-foreground">
          How much each engagement signal counts when ordering browse &amp; search.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="wView" className="text-xs">Per view</Label>
            <Input
              id="wView"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightView}
              onChange={(e) => set("rankWeightView", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wSave" className="text-xs">Per save</Label>
            <Input
              id="wSave"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightSave}
              onChange={(e) => set("rankWeightSave", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wClick" className="text-xs">Per WhatsApp click</Label>
            <Input
              id="wClick"
              type="number"
              min={0}
              max={100}
              value={form.rankWeightClick}
              onChange={(e) => set("rankWeightClick", Number(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Reviews</Label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={form.reviewsOpenToAll}
            onChange={(e) => set("reviewsOpenToAll", e.target.checked)}
          />
          <span>
            Allow <strong>any signed-in guest</strong> to review listings.
            <span className="block text-xs text-muted-foreground">
              Off (default): only guests who completed a stay at a listing can
              review it; everyone else can still read reviews.
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-700">Settings saved.</p>}

      <Button type="submit" variant="brand" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
