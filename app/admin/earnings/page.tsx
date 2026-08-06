import { prisma } from "@/lib/db";
import { getPnlData } from "@/lib/pnl";
import { EarningsPanel } from "@/components/admin/earnings-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Earnings" };

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export default async function AdminEarningsPage() {
  const [pnl, online] = await Promise.all([
    getPnlData(),
    prisma.onlineEarning.findMany({
      include: { listing: { select: { title: true, flatNumber: true, block: true } } },
      orderBy: [{ month: "desc" }, { updatedAt: "desc" }],
      take: 500,
    }),
  ]);

  const rows = pnl.rows.map((r) => ({
    listingId: r.listingId,
    label: r.label,
    month: r.month,
    year: r.year,
    revenueOnline: r.revenueOnline,
    revenueOffline: r.revenueOffline,
    revenueDirect: r.revenueDirect,
  }));

  const onlineEarnings = online.map((e) => ({
    id: e.id,
    listingId: e.listingId,
    label: flatLabel(e.listing),
    month: e.month,
    amount: e.amount,
  }));

  return (
    <EarningsPanel
      rows={rows}
      flats={pnl.flats}
      years={pnl.years}
      months={pnl.months}
      currentMonth={pnl.currentMonth}
      onlineEarnings={onlineEarnings}
    />
  );
}
