"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Download } from "lucide-react";
import { formatINR } from "@/lib/pricing";
import {
  filterScope,
  monthlyBreakdown,
  perFlatBreakdown,
  summarize,
  type PnlSummary,
} from "@/lib/pnl-compute";
import type { PnlListingMonth } from "@/lib/pnl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REVENUE = "#2f9e6f";
const EXPENSE = "#C8705E";
const PROFIT = "#111827";
const RENT = "#C8705E";
const STAFF = "#E0A99B";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const toRupees = (paise: number) => Math.round(paise) / 100;

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function PnlDashboard({
  rows,
  years,
  months,
  currentMonth,
}: {
  rows: PnlListingMonth[];
  years: number[];
  months: string[];
  currentMonth: string;
}) {
  const defaultYear = years.length ? years[years.length - 1] : new Date().getUTCFullYear();
  const [year, setYear] = useState<number>(defaultYear);
  const [month, setMonth] = useState<string>("all");

  const monthsOfYear = useMemo(() => months.filter((m) => Number(m.slice(0, 4)) === year), [months, year]);

  // KPIs / tables / pie honour the (year, month) scope.
  const scopedRows = useMemo(
    () => filterScope(rows, year, month === "all" ? undefined : month),
    [rows, year, month]
  );
  const total: PnlSummary = useMemo(() => summarize(scopedRows), [scopedRows]);

  // The trend chart always shows the whole selected year for context.
  const yearRows = useMemo(() => filterScope(rows, year), [rows, year]);
  const yearTotal: PnlSummary = useMemo(() => summarize(yearRows), [yearRows]);
  const monthly = useMemo(() => monthlyBreakdown(yearRows, monthsOfYear), [yearRows, monthsOfYear]);
  const perFlat = useMemo(() => perFlatBreakdown(scopedRows), [scopedRows]);

  const chartData = monthly.map((m) => ({
    label: m.label,
    Revenue: toRupees(m.revenueTotal),
    Expenses: toRupees(m.expenseTotal),
    Profit: toRupees(m.profit),
  }));
  const hasChart = chartData.some((d) => d.Revenue > 0 || d.Expenses > 0);

  const expensePie = [
    { name: "Rent", value: toRupees(total.rent) },
    { name: "Staff", value: toRupees(total.staff) },
  ].filter((d) => d.value > 0);

  const scopeLabel = month === "all" ? String(year) : monthLabel(month);
  const exportHref = `/api/admin/pnl/export?year=${year}${month === "all" ? "" : `&month=${month}`}`;

  const profitColor = total.profit >= 0 ? "text-green-700" : "text-destructive";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profit &amp; Loss</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue (online + offline + direct) minus rent &amp; staff costs — {scopeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <a
            href={exportHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            <Download className="h-4 w-4" /> Excel
          </a>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Total revenue" value={formatINR(total.revenueTotal)} sub={`${scopeLabel}`} />
        <Kpi label="Total expenses" value={formatINR(total.expenseTotal)} sub="rent + staff" />
        <Kpi label="Net profit" value={formatINR(total.profit)} sub={`${total.margin.toFixed(1)}% margin`} valueClass={profitColor} />
        <Kpi label="Net margin" value={`${total.margin.toFixed(1)}%`} sub="profit ÷ revenue" valueClass={profitColor} />
      </div>

      {/* Revenue vs expenses trend + profit line */}
      <div className="rounded-xl border p-5">
        <h2 className="mb-4 font-semibold">Revenue vs expenses · {year}</h2>
        {hasChart ? (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={(v) => inr0.format(v)} tickLine={false} axisLine={false} fontSize={12} width={72} />
              <Tooltip formatter={(value) => inr0.format(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb" }} />
              <Legend />
              <Bar dataKey="Revenue" fill={REVENUE} radius={[6, 6, 0, 0]} barSize={18} />
              <Bar dataKey="Expenses" fill={EXPENSE} radius={[6, 6, 0, 0]} barSize={18} />
              <Line type="monotone" dataKey="Profit" stroke={PROFIT} strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Revenue breakdown */}
        <div className="rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">Revenue mix · {scopeLabel}</h2>
          <StatRow label="Online (Airbnb etc.)" value={total.revenueOnline} strong />
          <StatRow label="Offline / walk-in" value={total.revenueOffline} strong />
          <StatRow label="Direct (WhatsApp)" value={total.revenueDirect} strong />
          <div className="my-2 border-t" />
          <StatRow label="Total revenue" value={total.revenueTotal} bold />
        </div>

        {/* Expense breakdown */}
        <div className="rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">Expenses · {scopeLabel}</h2>
          {expensePie.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={170}>
                <PieChart>
                  <Pie data={expensePie} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    <Cell fill={RENT} />
                    <Cell fill={STAFF} />
                  </Pie>
                  <Tooltip formatter={(value) => inr0.format(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1">
                <StatRow label="Rent" value={total.rent} strong dot={RENT} />
                <StatRow label="Staff salaries" value={total.staff} strong dot={STAFF} />
                <div className="my-2 border-t" />
                <StatRow label="Total expenses" value={total.expenseTotal} bold />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No rent or staff costs recorded for this period.</p>
          )}
        </div>
      </div>

      {/* Monthly table */}
      <section className="rounded-xl border p-5">
        <h2 className="mb-4 font-semibold">Monthly breakdown · {year}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 text-right font-medium">Revenue</th>
                <th className="py-2 text-right font-medium">Rent</th>
                <th className="py-2 text-right font-medium">Staff</th>
                <th className="py-2 text-right font-medium">Expenses</th>
                <th className="py-2 text-right font-medium">Profit</th>
                <th className="py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month} className="border-b last:border-0">
                  <td className="py-2 font-medium">{m.label}</td>
                  <td className="py-2 text-right">{formatINR(m.revenueTotal)}</td>
                  <td className="py-2 text-right text-muted-foreground">{formatINR(m.rent)}</td>
                  <td className="py-2 text-right text-muted-foreground">{formatINR(m.staff)}</td>
                  <td className="py-2 text-right">{formatINR(m.expenseTotal)}</td>
                  <td className={`py-2 text-right font-medium ${m.profit >= 0 ? "" : "text-destructive"}`}>{formatINR(m.profit)}</td>
                  <td className="py-2 text-right text-muted-foreground">{m.margin.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-semibold">Total · {year}</td>
                <td className="py-2 text-right font-semibold">{formatINR(yearTotal.revenueTotal)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(yearTotal.rent)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(yearTotal.staff)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(yearTotal.expenseTotal)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(yearTotal.profit)}</td>
                <td className="py-2 text-right font-semibold">{yearTotal.margin.toFixed(0)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Per-flat table */}
      {perFlat.length > 0 && (
        <section className="rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">By flat · {scopeLabel}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Flat</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">Expenses</th>
                  <th className="py-2 text-right font-medium">Profit</th>
                  <th className="py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {perFlat.map((f) => (
                  <tr key={f.listingId} className="border-b last:border-0">
                    <td className="py-2 font-medium">{f.label}</td>
                    <td className="py-2 text-right">{formatINR(f.revenueTotal)}</td>
                    <td className="py-2 text-right text-muted-foreground">{formatINR(f.expenseTotal)}</td>
                    <td className={`py-2 text-right font-medium ${f.profit >= 0 ? "" : "text-destructive"}`}>{formatINR(f.profit)}</td>
                    <td className="py-2 text-right text-muted-foreground">{f.margin.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, valueClass = "" }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  bold,
  strong,
  dot,
}: {
  label: string;
  value: number;
  bold?: boolean;
  strong?: boolean;
  dot?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className={`flex items-center gap-2 ${bold ? "font-semibold" : "text-muted-foreground"}`}>
        {dot && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span className={bold ? "font-bold" : strong ? "font-medium" : ""}>{formatINR(value)}</span>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-[340px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      No revenue or expenses to show yet.
    </div>
  );
}
