import { prisma } from "@/lib/db";
import { AirbnbEarnings } from "@/components/admin/airbnb-earnings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Airbnb earnings" };

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AdminAirbnbEarningsPage() {
  const [listings, online] = await Promise.all([
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    prisma.onlineEarning.findMany({
      include: { listing: { select: { title: true, flatNumber: true, block: true } } },
      orderBy: [{ month: "desc" }, { updatedAt: "desc" }],
      take: 500,
    }),
  ]);

  const flats = listings
    .map((l) => ({ id: l.id, label: flatLabel(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const entries = online.map((e) => ({
    id: e.id,
    listingId: e.listingId,
    label: flatLabel(e.listing),
    month: e.month,
    amount: e.amount,
  }));

  return <AirbnbEarnings flats={flats} entries={entries} defaultMonth={currentMonth()} />;
}
