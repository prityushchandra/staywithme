import { auth } from "@/lib/auth";
import { getPnlData } from "@/lib/pnl";
import { filterScope, monthlyBreakdown, perFlatBreakdown, summarize } from "@/lib/pnl-compute";
import { buildXlsx, type XlsxValue } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rupees(paise: number): number {
  return Math.round(paise) / 100;
}
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const data = await getPnlData();

  const yearParam = Number(url.searchParams.get("year"));
  const year = data.years.includes(yearParam) ? yearParam : data.years[data.years.length - 1] ?? new Date().getUTCFullYear();
  const monthParam = url.searchParams.get("month") || "";
  const month = /^\d{4}-\d{2}$/.test(monthParam) && monthParam.startsWith(String(year)) ? monthParam : "";

  const scopeLabel = month ? monthLabel(month) : `Year ${year}`;
  const monthsInScope = data.months.filter((m) => Number(m.slice(0, 4)) === year && (!month || m === month));

  const scopedRows = filterScope(data.rows, year, month || undefined);
  const total = summarize(scopedRows);
  const monthly = monthlyBreakdown(scopedRows, monthsInScope);
  const perFlat = perFlatBreakdown(scopedRows);

  // --- Summary sheet ---
  const summaryRows: XlsxValue[][] = [
    [`StayWithMe — Profit & Loss (${scopeLabel})`],
    [],
    ["Metric", "Amount"],
    ["Online revenue (Airbnb etc.)", rupees(total.revenueOnline)],
    ["Offline / walk-in revenue", rupees(total.revenueOffline)],
    ["Direct (WhatsApp) revenue", rupees(total.revenueDirect)],
    ["Total revenue", rupees(total.revenueTotal)],
    ["Rent", rupees(total.rent)],
    ["Staff salaries", rupees(total.staff)],
    ["Total expenses", rupees(total.expenseTotal)],
    ["Net profit", rupees(total.profit)],
    ["Net margin", pct(total.margin)],
  ];

  // --- Monthly sheet ---
  const monthlyHeader = [
    "Month",
    "Online",
    "Offline",
    "Direct",
    "Total revenue",
    "Rent",
    "Staff",
    "Total expenses",
    "Net profit",
    "Margin",
  ];
  const monthlyBody: XlsxValue[][] = monthly.map((m) => [
    m.label,
    rupees(m.revenueOnline),
    rupees(m.revenueOffline),
    rupees(m.revenueDirect),
    rupees(m.revenueTotal),
    rupees(m.rent),
    rupees(m.staff),
    rupees(m.expenseTotal),
    rupees(m.profit),
    pct(m.margin),
  ]);
  const monthlyTotal: XlsxValue[] = [
    "Total",
    rupees(total.revenueOnline),
    rupees(total.revenueOffline),
    rupees(total.revenueDirect),
    rupees(total.revenueTotal),
    rupees(total.rent),
    rupees(total.staff),
    rupees(total.expenseTotal),
    rupees(total.profit),
    pct(total.margin),
  ];
  const moneyCols = [1, 2, 3, 4, 5, 6, 7, 8];

  // --- By-flat sheet ---
  const flatHeader = ["Flat", "Total revenue", "Rent", "Staff", "Total expenses", "Net profit", "Margin"];
  const flatBody: XlsxValue[][] = perFlat.map((f) => [
    f.label,
    rupees(f.revenueTotal),
    rupees(f.rent),
    rupees(f.staff),
    rupees(f.expenseTotal),
    rupees(f.profit),
    pct(f.margin),
  ]);

  const xlsx = buildXlsx([
    { name: "Summary", rows: summaryRows, headerRow: false, moneyColumns: [1], colWidths: [32, 16] },
    {
      name: "Monthly",
      rows: [monthlyHeader, ...monthlyBody, monthlyTotal],
      headerRow: true,
      moneyColumns: moneyCols,
      colWidths: [16, 12, 12, 12, 15, 12, 12, 15, 13, 9],
    },
    {
      name: "By flat",
      rows: [flatHeader, ...flatBody],
      headerRow: true,
      moneyColumns: [1, 2, 3, 4, 5],
      colWidths: [26, 15, 12, 12, 15, 13, 9],
    },
  ]);

  const filename = `StayWithMe-P&L-${month || year}.xlsx`;
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
