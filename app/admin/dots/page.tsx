import { DotMarker } from "@/components/admin/dot-marker";
import { prisma } from "@/lib/db";
import { syncStaleCalendars } from "@/lib/calendar-sync";
import { financialYearLabel, financialYearStart, monthsOfFinancialYear, todayInIndia } from "@/lib/pnl-compute";

export const metadata = { title: "Admin · Dot days" };
export const dynamic = "force-dynamic";

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export default async function AdminDotsPage() {
  // The calendar decides which days even LOOK open, so a stale Airbnb feed would
  // offer up days that actually sold. Refresh before drawing the month.
  await syncStaleCalendars(60_000);

  const today = new Date(todayInIndia(new Date()));
  const month = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const fyStart = financialYearStart(month);
  const fyMonths = monthsOfFinancialYear(fyStart);

  const [listings, dotRows] = await Promise.all([
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    prisma.listingDotMonth.findMany({
      where: { month: { in: fyMonths } },
      select: { listingId: true, month: true, days: true },
    }),
  ]);

  const thisMonth = dotRows
    .filter((r) => r.month === month)
    .reduce((s, r) => s + r.days.length, 0);
  const thisFy = dotRows.reduce((s, r) => s + r.days.length, 0);

  const flats = listings
    .map((l) => ({ id: l.id, label: flatLabel(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dot days</h1>
        <p className="text-muted-foreground">
          A dot is a day a flat lost: it was on the market, nobody booked it, and the day ended. Mark
          them yourself — once a date has passed, Airbnb closes it off whether it sold or not, so the
          calendar can no longer tell the difference. Dots feed straight into the P&amp;L, both on
          their own and inside unbooked days.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Dots this month</p>
          <p className="mt-2 text-2xl font-semibold">{thisMonth}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Dots in {financialYearLabel(fyStart)}</p>
          <p className="mt-2 text-2xl font-semibold">{thisFy}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Flats</p>
          <p className="mt-2 text-2xl font-semibold">{listings.length}</p>
        </div>
      </div>

      <DotMarker initialMonth={month} listings={flats} />
    </div>
  );
}
