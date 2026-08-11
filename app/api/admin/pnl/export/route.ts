import { auth } from "@/lib/auth";
import { getPnlData } from "@/lib/pnl";
import {
  monthlyBreakdown,
  perFlatBreakdown,
  summarize,
  scopeSummary,
  sourceRevenue,
  sourceNights,
  avgPerDay,
  filterFinancialYear,
  financialYearLabel,
  financialYearsFromMonths,
  monthsOfFinancialYear,
  type PnlSource,
} from "@/lib/pnl-compute";
import { buildXlsx, type XlsxValue } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<PnlSource, string> = {
  both: "Online + offline",
  online: "Online (Airbnb)",
  offline: "Offline (direct)",
};

function rupees(paise: number): number {
  return Math.round(paise) / 100;
}
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}
function monthLabelLong(monthKey: string): string {
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

  const fyList = financialYearsFromMonths(data.months);
  const fyParam = Number(url.searchParams.get("fy"));
  const fy = fyList.includes(fyParam) ? fyParam : fyList[fyList.length - 1] ?? new Date().getUTCFullYear();

  const monthParam = url.searchParams.get("month") || "";
  const fyMonths = monthsOfFinancialYear(fy);
  const month = /^\d{4}-\d{2}$/.test(monthParam) && fyMonths.includes(monthParam) ? monthParam : "";

  const sourceParam = url.searchParams.get("source") as PnlSource | null;
  const source: PnlSource = sourceParam === "online" || sourceParam === "offline" ? sourceParam : "both";

  const fyLabel = financialYearLabel(fy);
  const scopeLabel = month ? monthLabelLong(month) : fyLabel;
  const monthsInScope = fyMonths.filter((m) => m <= data.currentMonth && (!month || m === month));

  const scopedRows = filterFinancialYear(data.rows, fy, month || undefined);
  const total = summarize(scopedRows);
  const scopedTotal = scopeSummary(total, source);
  const monthly = monthlyBreakdown(scopedRows, monthsInScope);
  const perFlat = perFlatBreakdown(scopedRows);

  // --- Summary sheet ---
  const summaryRows: XlsxValue[][] = [
    [`StayWithMe — Profit & Loss (${scopeLabel})`],
    [`Channel: ${SOURCE_LABEL[source]}`],
    [],
    ["Metric", "Amount"],
  ];
  if (source !== "offline") summaryRows.push(["Online (Airbnb)", rupees(total.revenueOnline)]);
  if (source !== "online") {
    summaryRows.push(["Offline / walk-in", rupees(total.revenueOffline)]);
    summaryRows.push(["Direct (WhatsApp)", rupees(total.revenueDirect)]);
  }
  summaryRows.push(
    ["Total revenue", rupees(scopedTotal.revenue)],
    // Day counts are NOT currency, so keep them strings so the ₹ number format
    // on this column doesn't apply to them.
    ["Days booked", `${scopedTotal.nights}`],
    ["Avg per booked day", scopedTotal.avgPerDay === null ? "—" : rupees(scopedTotal.avgPerDay)],
    ["Rent", rupees(total.rent)],
    ["Staff salaries", rupees(total.staff)],
    ["Total expenses", rupees(total.expenseTotal)],
    ["Net profit", rupees(scopedTotal.profit)],
    ["Net margin", pct(scopedTotal.margin)],
    ["Unbooked (available) days", `${total.unbookedDays}`]
  );

  // --- Monthly sheet ---
  const monthlyHeader = ["Month", "Revenue", "Rent", "Staff", "Total expenses", "Net profit", "Margin", "Unbooked days"];
  const monthlyBody: XlsxValue[][] = monthly.map((m) => {
    const rev = sourceRevenue(m, source);
    const profit = rev - m.expenseTotal;
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    return [m.label, rupees(rev), rupees(m.rent), rupees(m.staff), rupees(m.expenseTotal), rupees(profit), pct(margin), m.unbookedDays];
  });
  const monthlyTotal: XlsxValue[] = [
    "Total",
    rupees(scopedTotal.revenue),
    rupees(total.rent),
    rupees(total.staff),
    rupees(total.expenseTotal),
    rupees(scopedTotal.profit),
    pct(scopedTotal.margin),
    total.unbookedDays,
  ];

  // --- By-flat sheet ---
  const flatHeader = ["Flat", "Revenue", "Days booked", "Avg / day", "Rent", "Staff", "Total expenses", "Net profit", "Margin", "Unbooked days"];
  const flatBody: XlsxValue[][] = perFlat.map((f) => {
    const rev = sourceRevenue(f, source);
    const profit = rev - f.expenseTotal;
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    const adr = avgPerDay(f, source);
    return [
      f.label,
      rupees(rev),
      sourceNights(f, source),
      adr === null ? "—" : rupees(adr),
      rupees(f.rent),
      rupees(f.staff),
      rupees(f.expenseTotal),
      rupees(profit),
      pct(margin),
      f.unbookedDays,
    ];
  });
  const flatTotal: XlsxValue[] = [
    "All flats",
    rupees(scopedTotal.revenue),
    scopedTotal.nights,
    scopedTotal.avgPerDay === null ? "—" : rupees(scopedTotal.avgPerDay),
    rupees(total.rent),
    rupees(total.staff),
    rupees(total.expenseTotal),
    rupees(scopedTotal.profit),
    pct(scopedTotal.margin),
    total.unbookedDays,
  ];

  const xlsx = buildXlsx([
    { name: "Summary", rows: summaryRows, headerRow: false, moneyColumns: [1], colWidths: [30, 16] },
    {
      name: "Monthly",
      rows: [monthlyHeader, ...monthlyBody, monthlyTotal],
      headerRow: true,
      moneyColumns: [1, 2, 3, 4, 5],
      colWidths: [16, 15, 12, 12, 15, 13, 9, 14],
    },
    {
      name: "By flat",
      rows: [flatHeader, ...flatBody, flatTotal],
      headerRow: true,
      moneyColumns: [1, 3, 4, 5, 6, 7],
      colWidths: [26, 15, 13, 13, 12, 12, 15, 13, 9, 14],
    },
  ]);

  const filename = `StayWithMe-PnL-FY${fy}-${fy + 1}${month ? `-${month}` : ""}-${source}.xlsx`;
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
