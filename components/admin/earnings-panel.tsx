"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Trash2 } from "lucide-react";
import { formatINR } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface EarningRow {
  listingId: string;
  label: string;
  month: string; // YYYY-MM
  year: number;
  revenueOnline: number;
  revenueOffline: number;
  revenueDirect: number;
}
export interface OnlineEarningRow {
  id: string;
  listingId: string;
  label: string;
  month: string;
  amount: number;
}
interface Flat {
  id: string;
  label: string;
}

const BRAND = "#C8705E";
const ONLINE = BRAND;
const OFFLINE = "#E0A99B";
const DIRECT = "#7F3E34";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const toRupees = (paise: number) => Math.round(paise) / 100;

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function EarningsPanel({
  rows,
  flats,
  years,
  months,
  currentMonth,
  onlineEarnings,
}: {
  rows: EarningRow[];
  flats: Flat[];
  years: number[];
  months: string[];
  currentMonth: string;
  onlineEarnings: OnlineEarningRow[];
}) {
  const defaultYear = years.length ? years[years.length - 1] : new Date().getUTCFullYear();
  const [flatId, setFlatId] = useState<string>("all");
  const [year, setYear] = useState<number>(defaultYear);
  const [month, setMonth] = useState<string>("all");

  const monthsOfYear = useMemo(
    () => months.filter((m) => Number(m.slice(0, 4)) === year),
    [months, year]
  );

  // Bars: one per month in the selected year (or just the selected month),
  // stacked by revenue source, filtered by flat.
  const chartData = useMemo(() => {
    const keys = month === "all" ? monthsOfYear : monthsOfYear.filter((m) => m === month);
    return keys.map((mk) => {
      let online = 0,
        offline = 0,
        direct = 0;
      for (const r of rows) {
        if (r.month !== mk) continue;
        if (flatId !== "all" && r.listingId !== flatId) continue;
        online += r.revenueOnline;
        offline += r.revenueOffline;
        direct += r.revenueDirect;
      }
      return {
        month: mk,
        label: monthLabel(mk),
        Online: toRupees(online),
        Offline: toRupees(offline),
        Direct: toRupees(direct),
        total: online + offline + direct,
      };
    });
  }, [rows, monthsOfYear, month, flatId]);

  const scopeTotalPaise = useMemo(
    () => Math.round(chartData.reduce((s, d) => s + d.total, 0)),
    [chartData]
  );
  const hasData = chartData.some((d) => d.total > 0);

  const scopeLabel =
    (flatId === "all" ? "All flats" : flats.find((f) => f.id === flatId)?.label ?? "Flat") +
    " · " +
    (month === "all" ? String(year) : monthLabel(month));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Earnings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue from online (Airbnb etc.), offline / walk-in, and direct WhatsApp bookings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={flatId} onValueChange={setFlatId}>
            <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flats</SelectItem>
              {flats.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setMonth("all"); }}>
            <SelectTrigger className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole year</SelectItem>
              {monthsOfYear.map((m) => (
                <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Earnings · {scopeLabel}</h2>
          <div className="text-right">
            <div className="text-2xl font-bold">{formatINR(scopeTotalPaise)}</div>
            <div className="text-xs text-muted-foreground">total for selection</div>
          </div>
        </div>
        {hasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={(v) => inr0.format(v)} tickLine={false} axisLine={false} fontSize={12} width={72} />
              <Tooltip
                formatter={(value) => inr0.format(Number(value))}
                labelClassName="text-foreground"
                contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb" }}
              />
              <Legend />
              <Bar dataKey="Online" stackId="rev" fill={ONLINE} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Offline" stackId="rev" fill={OFFLINE} />
              <Bar dataKey="Direct" stackId="rev" fill={DIRECT} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No earnings for this selection.
          </div>
        )}
      </div>

      <OnlineEarningsEditor flats={flats} entries={onlineEarnings} defaultMonth={currentMonth} />
    </div>
  );
}

function OnlineEarningsEditor({
  flats,
  entries,
  defaultMonth,
}: {
  flats: Flat[];
  entries: OnlineEarningRow[];
  defaultMonth: string;
}) {
  const router = useRouter();
  const [listingId, setListingId] = useState<string>(flats[0]?.id ?? "");
  const [month, setMonth] = useState<string>(defaultMonth);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

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
    if (!confirm("Delete this online earnings entry?")) return;
    const res = await fetch(`/api/admin/online-earnings?id=${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <section className="rounded-xl border p-5">
      <h2 className="font-semibold">Record online earnings</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Airbnb / Booking.com payouts can&apos;t be pulled automatically — enter each flat&apos;s
        monthly online total here so it shows in the graph above and the Profit &amp; Loss statement.
        Saving again for the same flat &amp; month overwrites the figure.
      </p>

      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px_150px_auto] sm:items-end">
        <div className="space-y-1">
          <Label>Flat</Label>
          <Select value={listingId} onValueChange={setListingId}>
            <SelectTrigger><SelectValue placeholder="Choose flat" /></SelectTrigger>
            <SelectContent>
              {flats.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="oe-month">Month</Label>
          <Input id="oe-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="oe-amount">Earnings (₹)</Label>
          <Input
            id="oe-amount"
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

      {entries.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 font-medium">Flat</th>
                <th className="py-2 text-right font-medium">Online earnings</th>
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
  );
}
