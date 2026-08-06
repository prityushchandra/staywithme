"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from "recharts";
import type { ReactNode } from "react";
import type { EarningsData } from "@/lib/earnings";

const BRAND = "#C8705E";
const COLORS = [BRAND, "#DFA091", "#F0C7BD", "#A95445", "#7F3E34"];

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function toRupees(paise: number) {
  return Math.round(paise) / 100;
}

function chartValue(value: unknown): string {
  return typeof value === "number" ? inr.format(value) : String(value ?? "");
}

function ChartCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-xl border p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {empty ? (
        <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No earnings to show yet.
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function EarningsCharts({ data }: { data: EarningsData }) {
  const monthly = data.monthly.map((item) => ({
    ...item,
    rupees: toRupees(item.paise),
  }));
  const perProperty = data.perProperty.slice(0, 8).map((item) => ({
    ...item,
    rupees: toRupees(item.paise),
  }));
  const yearly = data.yearly.map((item) => ({
    ...item,
    label: String(item.year),
    rupees: toRupees(item.paise),
  }));
  const hasEarnings = data.totalPaise > 0;

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Monthly earnings" empty={!hasEarnings}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthly} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={(value) => inr.format(value)} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={chartValue} labelClassName="text-foreground" />
            <Line
              type="monotone"
              dataKey="rupees"
              name="Earnings"
              stroke={BRAND}
              strokeWidth={3}
              dot={{ r: 3, fill: BRAND }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Earnings by property" empty={perProperty.length === 0}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={perProperty}
            layout="vertical"
            margin={{ top: 6, right: 16, left: 16, bottom: 6 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(value) => inr.format(value)} tickLine={false} axisLine={false} fontSize={12} />
            <YAxis
              type="category"
              dataKey="label"
              width={130}
              tickLine={false}
              axisLine={false}
              fontSize={12}
            />
            <Tooltip formatter={chartValue} labelClassName="text-foreground" />
            <Bar dataKey="rupees" name="Earnings" radius={[0, 8, 8, 0]} fill={BRAND} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Year-wise totals" empty={yearly.length === 0}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={yearly} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={(value) => inr.format(value)} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={chartValue} labelClassName="text-foreground" />
            <Bar dataKey="rupees" name="Earnings" radius={[8, 8, 0, 0]}>
              {yearly.map((item, index) => (
                <Cell key={item.year} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}
