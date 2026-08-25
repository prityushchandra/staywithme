import { DotMarker } from "@/components/admin/dot-marker";
import { prisma } from "@/lib/db";
import { syncStaleCalendars } from "@/lib/calendar-sync";
import { todayInIndia } from "@/lib/pnl-compute";

export const metadata = { title: "Admin · Dot days" };
export const dynamic = "force-dynamic";

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export default async function AdminDotsPage() {
  // The calendar decides which days even look open, so a stale Airbnb feed would
  // offer up days that actually sold. Refresh before drawing the month.
  await syncStaleCalendars(60_000);

  const today = new Date(todayInIndia(new Date()));
  const month = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;

  const listings = await prisma.listing.findMany({
    select: { id: true, title: true, flatNumber: true, block: true },
  });

  const flats = listings
    .map((l) => ({ id: l.id, label: flatLabel(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dot days</h1>
        <p className="text-muted-foreground">
          A dot is a day a flat lost: it was on the market, nobody booked it, and the day ended. These
          feed the P&amp;L, both on their own and inside unbooked days.
        </p>
      </div>

      <DotMarker initialMonth={month} listings={flats} />
    </div>
  );
}
