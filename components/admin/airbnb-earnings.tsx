"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatINR } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import { ToggleSelect } from "@/components/ui/toggle-select";

interface Flat {
  id: string;
  label: string;
}
export interface AirbnbEarningRow {
  id: string;
  listingId: string;
  label: string;
  month: string; // YYYY-MM
  amount: number; // paise
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function AirbnbEarnings({
  flats,
  entries,
  defaultMonth,
}: {
  flats: Flat[];
  entries: AirbnbEarningRow[];
  defaultMonth: string;
}) {
  const router = useRouter();
  const [listingId, setListingId] = useState<string>(flats[0]?.id ?? "");
  const [month, setMonth] = useState<string>(defaultMonth);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const total = entries.reduce((s, e) => s + e.amount, 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!listingId || !month || amount === "") {
      setError("Pick a flat, a month, and enter the amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/online-earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, month, amountRupees: Number(amount) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setOk("Saved.");
      setAmount("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this Airbnb earnings entry?")) return;
    const res = await fetch(`/api/admin/online-earnings?id=${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Airbnb earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Airbnb payouts can&apos;t be pulled automatically. Enter each flat&apos;s monthly Airbnb
          total here — it feeds the Profit &amp; Loss statement as online revenue. Saving again for
          the same flat &amp; month overwrites the figure.
        </p>
      </div>

      <section className="rounded-xl border p-5">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_160px_160px_auto] sm:items-end">
          <div className="space-y-1">
            <Label>Flat</Label>
            <ToggleSelect value={listingId} onValueChange={setListingId} placeholder="Choose flat" ariaLabel="Flat">
              {flats.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </ToggleSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ae-month">Month</Label>
            <Input id="ae-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ae-amount">Airbnb earnings (₹)</Label>
            <Input
              id="ae-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || flats.length === 0}>{busy ? "Saving…" : "Save"}</Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {ok && <p className="mt-2 text-sm text-green-700">{ok}</p>}
      </section>

      <section className="rounded-xl border p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold">Recorded Airbnb earnings</h2>
          {entries.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Total <span className="font-semibold text-foreground">{formatINR(total)}</span>
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Airbnb earnings recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Month</th>
                  <th className="py-2 font-medium">Flat</th>
                  <th className="py-2 text-right font-medium">Airbnb earnings</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2">{monthLabel(e.month)}</td>
                    <td className="py-2">{e.label}</td>
                    <td className="py-2 text-right font-medium">{formatINR(e.amount)}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(e.id)}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
