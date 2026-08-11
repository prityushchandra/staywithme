"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Download } from "lucide-react";
import { formatINR } from "@/lib/pricing";
import {
  monthlyBreakdown,
  perFlatBreakdown,
  summarize,
  scopeSummary,
  sourceRevenue,
  sourceNights,
  avgPerDay,
  filterFinancialYear,
  financialYearsFromMonths,
  financialYearLabel,
  financialYearStart,
  monthsOfFinancialYear,
  type PnlSummary,
  type PnlSource,
} from "@/lib/pnl-compute";
import type { PnlListingMonth } from "@/lib/pnl";
import { SelectItem } from "@/components/ui/select";
import { ToggleSelect } from "@/components/ui/toggle-select";

const REVENUE = "#2f9e6f";
const EXPENSE = "#C8705E";
const RENT = "#C8705E";
const STAFF = "#E0A99B";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const toRupees = (paise: number) => Math.round(paise) / 100;

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// A clean, no-jitter tooltip: shown on CLICK (not hover), so it doesn't chase the
// cursor. Recharts hides it when you click elsewhere in the chart.
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="pointer-events-none rounded-xl border bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
      {label ? <div className="mb-1.5 font-semibold text-foreground">{label}</div> : null}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? p.payload?.fill ?? "#999" }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto pl-4 font-semibold text-foreground">{inr0.format(Number(p.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<PnlSource, string> = {
  both: "Online + offline",
  online: "Online (Airbnb)",
  offline: "Offline (direct)",
};

export function PnlDashboard({
  rows,
  months,
  currentMonth,
}: {
  rows: PnlListingMonth[];
  months: string[];
  currentMonth: string;
}) {
  const fyStarts = useMemo(() => {
    const list = financialYearsFromMonths(months);
    return list.length ? list : [financialYearStart(currentMonth)];
  }, [months, currentMonth]);

  // Default to the current financial year and CURRENT MONTH (not the whole year).
  const currentFy = financialYearStart(currentMonth);
  const defaultFy = fyStarts.includes(currentFy) ? currentFy : fyStarts[fyStarts.length - 1];
  const [fy, setFy] = useState<number>(defaultFy);
  const [month, setMonth] = useState<string>(defaultFy === currentFy ? currentMonth : "all");
  const [source, setSource] = useState<PnlSource>("both");

  // The 12 FY months (Apr…Mar) are all selectable — past months for P&L history,
  // the current and upcoming months for still-available inventory.
  const fyMonths = useMemo(() => monthsOfFinancialYear(fy), [fy]);
  const selectableMonths = fyMonths;

  // Scope: whole FY or a single month within it.
  const scopedRows = useMemo(
    () => filterFinancialYear(rows, fy, month === "all" ? undefined : month),
    [rows, fy, month]
  );
  const total: PnlSummary = useMemo(() => summarize(scopedRows), [scopedRows]);
  const scoped = useMemo(() => scopeSummary(total, source), [total, source]);

  // Trend chart spans the whole FY for context.
  const fyRows = useMemo(() => filterFinancialYear(rows, fy), [rows, fy]);
  const monthly = useMemo(() => monthlyBreakdown(fyRows, fyMonths), [fyRows, fyMonths]);
  const perFlat = useMemo(() => perFlatBreakdown(scopedRows), [scopedRows]);

  const chartData = monthly.map((m) => {
    const revenue = toRupees(sourceRevenue(m, source));
    const expenses = toRupees(m.expenseTotal);
    return { label: m.label.replace(/ \d{4}$/, ""), Revenue: revenue, Expenses: expenses };
  });
  const hasChart = chartData.some((d) => d.Revenue > 0 || d.Expenses > 0);

  const mix = useMemo(() => {
    const out: { name: string; value: number }[] = [];
    if (source !== "offline") out.push({ name: "Online (Airbnb)", value: total.revenueOnline });
    if (source !== "online") {
      out.push({ name: "Offline / walk-in", value: total.revenueOffline });
      out.push({ name: "Direct (WhatsApp)", value: total.revenueDirect });
    }
    return out;
  }, [total, source]);

  const expensePie = [
    { name: "Rent", value: toRupees(total.rent) },
    { name: "Staff", value: toRupees(total.staff) },
  ].filter((d) => d.value > 0);

  const fyLabel = financialYearLabel(fy);
  const scopeLabel = month === "all" ? fyLabel : monthLabel(month);
  const exportHref = `/api/admin/pnl/export?fy=${fy}&source=${source}${month === "all" ? "" : `&month=${month}`}`;
  const profitColor = scoped.profit >= 0 ? "text-green-700" : "text-destructive";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profit &amp; Loss</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {SOURCE_LABEL[source]} revenue minus rent &amp; staff costs — {scopeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleSelect value={source} onValueChange={(v) => setSource(v as PnlSource)} triggerClassName="h-9 w-[170px]" ariaLabel="Revenue channel">
            <SelectItem value="both">Online + offline</SelectItem>
            <SelectItem value="online">Online (Airbnb)</SelectItem>
            <SelectItem value="offline">Offline (direct)</SelectItem>
          </ToggleSelect>
          <ToggleSelect value={String(fy)} onValueChange={(v) => { setFy(Number(v)); setMonth("all"); }} triggerClassName="h-9 w-[140px]" ariaLabel="Financial year">
            {fyStarts.map((y) => (
              <SelectItem key={y} value={String(y)}>{financialYearLabel(y)}</SelectItem>
            ))}
          </ToggleSelect>
          <ToggleSelect value={month} onValueChange={setMonth} triggerClassName="h-9 w-[150px]" ariaLabel="Month">
            <SelectItem value="all">Whole year</SelectItem>
            {selectableMonths.map((m) => (
              <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
            ))}
          </ToggleSelect>
          <a
            href={exportHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            <Download className="h-4 w-4" /> Excel
          </a>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <Kpi label="Total revenue" value={formatINR(scoped.revenue)} sub={SOURCE_LABEL[source]} />
        <Kpi
          label="Avg per day"
          value={scoped.avgPerDay === null ? "—" : formatINR(scoped.avgPerDay)}
          sub={scoped.nights > 0 ? `over ${scoped.nights} booked ${scoped.nights === 1 ? "day" : "days"}` : "no booked days yet"}
        />
        <Kpi label="Total expenses" value={formatINR(total.expenseTotal)} sub="rent + staff" />
        <Kpi label="Net profit" value={formatINR(scoped.profit)} sub={`${scoped.margin.toFixed(1)}% margin`} valueClass={profitColor} />
        <Kpi label="Unbooked days" value={String(total.unbookedDays)} sub="available, not booked" />
      </div>

      {/* Revenue vs expenses trend */}
      <div className="rounded-xl border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Revenue vs expenses · {fyLabel}</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: REVENUE }} />Revenue</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: EXPENSE }} />Expenses</span>
          </div>
        </div>
        {hasChart ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={4} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="2 6" stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} dy={6} />
                <YAxis tickFormatter={(v) => inr0.format(v)} tickLine={false} axisLine={false} fontSize={11} width={64} />
                <Tooltip content={<ChartTooltip />} trigger="click" isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="Revenue" fill={REVENUE} radius={[6, 6, 0, 0]} maxBarSize={26} />
                <Bar dataKey="Expenses" fill={EXPENSE} radius={[6, 6, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">Tap a bar to see the exact amounts.</p>
          </>
        ) : (
          <Empty label="No revenue or expenses to show yet." />
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Revenue mix */}
        <div className="rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">Revenue mix · {scopeLabel}</h2>
          {mix.map((row) => (
            <StatRow key={row.name} label={row.name} value={row.value} strong />
          ))}
          <div className="my-2 border-t" />
          <StatRow label="Total revenue" value={scoped.revenue} bold />
        </div>

        {/* Expense breakdown */}
        <div className="rounded-xl border p-5">
          <h2 className="mb-4 font-semibold">Expenses · {scopeLabel}</h2>
          {expensePie.length > 0 ? (
            <div className="flex items-center gap-5">
              <ResponsiveContainer width="45%" height={160}>
                <PieChart>
                  <Pie data={expensePie} dataKey="value" nameKey="name" innerRadius={46} outerRadius={72} paddingAngle={3} stroke="none" isAnimationActive={false}>
                    <Cell fill={RENT} />
                    <Cell fill={STAFF} />
                  </Pie>
                  <Tooltip content={<ChartTooltip />} trigger="click" isAnimationActive={false} />
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

      {/* Unbooked (vacancy) tracking — flat-wise */}
      <section className="rounded-xl border p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Unbooked days · {scopeLabel}</h2>
          <span className="text-sm text-muted-foreground">
            Total <span className="font-semibold text-foreground">{total.unbookedDays}</span> available days
          </span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Days still open on each flat&apos;s calendar (today onward) with no booking. Past days and
          blocked/booked days aren&apos;t counted — so a fully-booked or fully-blocked month shows 0.
        </p>
        {perFlat.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flats to show for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Flat</th>
                  <th className="py-2 text-right font-medium">Unbooked days</th>
                </tr>
              </thead>
              <tbody>
                {[...perFlat]
                  .sort((a, b) => b.unbookedDays - a.unbookedDays)
                  .map((f) => (
                    <tr key={f.listingId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{f.label}</td>
                      <td className="py-2 text-right">{f.unbookedDays}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Monthly table */}
      <section className="rounded-xl border p-5">
        <h2 className="mb-4 font-semibold">Monthly breakdown · {fyLabel}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 text-right font-medium">Revenue</th>
                <th className="py-2 text-right font-medium">Expenses</th>
                <th className="py-2 text-right font-medium">Profit</th>
                <th className="py-2 text-right font-medium">Margin</th>
                <th className="py-2 text-right font-medium">Unbooked</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const rev = sourceRevenue(m, source);
                const profit = rev - m.expenseTotal;
                const margin = rev > 0 ? (profit / rev) * 100 : 0;
                return (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-2 font-medium">{m.label}</td>
                    <td className="py-2 text-right">{formatINR(rev)}</td>
                    <td className="py-2 text-right text-muted-foreground">{formatINR(m.expenseTotal)}</td>
                    <td className={`py-2 text-right font-medium ${profit >= 0 ? "" : "text-destructive"}`}>{formatINR(profit)}</td>
                    <td className="py-2 text-right text-muted-foreground">{margin.toFixed(0)}%</td>
                    <td className="py-2 text-right text-muted-foreground">{m.unbookedDays}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-semibold">Total · {fyLabel}</td>
                <td className="py-2 text-right font-semibold">{formatINR(sourceRevenue(summarize(fyRows), source))}</td>
                <td className="py-2 text-right font-semibold">{formatINR(summarize(fyRows).expenseTotal)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(scopeSummary(summarize(fyRows), source).profit)}</td>
                <td className="py-2 text-right font-semibold">{scopeSummary(summarize(fyRows), source).margin.toFixed(0)}%</td>
                <td className="py-2 text-right font-semibold">{summarize(fyRows).unbookedDays}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Per-flat P&L table */}
      {perFlat.length > 0 && (
        <section className="rounded-xl border p-5">
          <h2 className="mb-1 font-semibold">By flat · {scopeLabel}</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Avg per day is that flat&apos;s {SOURCE_LABEL[source].toLowerCase()} revenue divided by the nights
            actually booked, so it reflects the rate you really achieved — not the listed price.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Flat</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">Days booked</th>
                  <th className="py-2 text-right font-medium">Avg / day</th>
                  <th className="py-2 text-right font-medium">Expenses</th>
                  <th className="py-2 text-right font-medium">Profit</th>
                  <th className="py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {perFlat.map((f) => {
                  const rev = sourceRevenue(f, source);
                  const profit = rev - f.expenseTotal;
                  const margin = rev > 0 ? (profit / rev) * 100 : 0;
                  const nights = sourceNights(f, source);
                  const adr = avgPerDay(f, source);
                  return (
                    <tr key={f.listingId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{f.label}</td>
                      <td className="py-2 text-right">{formatINR(rev)}</td>
                      <td className="py-2 text-right text-muted-foreground">{nights}</td>
                      <td className="py-2 text-right font-medium">{adr === null ? "—" : formatINR(adr)}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatINR(f.expenseTotal)}</td>
                      <td className={`py-2 text-right font-medium ${profit >= 0 ? "" : "text-destructive"}`}>{formatINR(profit)}</td>
                      <td className="py-2 text-right text-muted-foreground">{margin.toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="py-2 font-semibold">All flats</td>
                  <td className="py-2 text-right font-semibold">{formatINR(scoped.revenue)}</td>
                  <td className="py-2 text-right font-semibold">{scoped.nights}</td>
                  <td className="py-2 text-right font-semibold">{scoped.avgPerDay === null ? "—" : formatINR(scoped.avgPerDay)}</td>
                  <td className="py-2 text-right font-semibold">{formatINR(total.expenseTotal)}</td>
                  <td className="py-2 text-right font-semibold">{formatINR(scoped.profit)}</td>
                  <td className="py-2 text-right font-semibold">{scoped.margin.toFixed(0)}%</td>
                </tr>
              </tfoot>
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

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-[340px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}
