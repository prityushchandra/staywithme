import { prisma } from "@/lib/db";
import { memo } from "@/lib/memo";

type Source = "Direct (WhatsApp)" | "Offline" | "Airbnb";

export interface EarningsData {
  totalPaise: number;
  thisMonthPaise: number;
  thisYearPaise: number;
  bookingsCount: number;
  perProperty: { propertyId: string; label: string; paise: number }[];
  monthly: { month: string; label: string; paise: number }[];
  yearly: { year: number; paise: number }[];
  bySource: { source: string; paise: number }[];
}

interface EarningRow {
  propertyId: string;
  label: string;
  checkIn: Date;
  paise: number;
  source: Source;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function propertyLabel(listing: { title: string; flatNumber: string | null; block: string | null }) {
  const base = listing.flatNumber?.trim() || listing.title;
  return listing.block?.trim() ? `${base}, ${listing.block.trim()}` : base;
}

function add(map: Map<string, number>, key: string, paise: number) {
  map.set(key, (map.get(key) ?? 0) + paise);
}

export async function getEarnings(): Promise<EarningsData> {
  return memo("admin-earnings", 30_000, async () => {
    const [directBookings, offlineBookings] = await Promise.all([
      prisma.booking.findMany({
        where: { status: "CONFIRMED" },
        select: {
          listingId: true,
          checkIn: true,
          totalAmount: true,
          listing: { select: { title: true, flatNumber: true, block: true } },
        },
      }),
      prisma.offlineBooking.findMany({
        where: { status: "CONFIRMED" },
        select: {
          listingId: true,
          checkIn: true,
          totalPrice: true,
          source: true,
          listing: { select: { title: true, flatNumber: true, block: true } },
        },
      }),
    ]);

    const rows: EarningRow[] = [
      ...directBookings.map((booking) => ({
        propertyId: booking.listingId,
        label: propertyLabel(booking.listing),
        checkIn: booking.checkIn,
        paise: booking.totalAmount,
        source: "Direct (WhatsApp)" as const,
      })),
      ...offlineBookings.map((booking) => ({
        propertyId: booking.listingId,
        label: propertyLabel(booking.listing),
        checkIn: booking.checkIn,
        paise: booking.totalPrice,
        source: booking.source === "AIRBNB" ? ("Airbnb" as const) : ("Offline" as const),
      })),
    ];

    const now = new Date();
    const thisMonth = monthKey(now);
    const thisYear = now.getUTCFullYear();
    const propertyTotals = new Map<string, { propertyId: string; label: string; paise: number }>();
    const monthTotals = new Map<string, number>();
    const yearTotals = new Map<number, number>();
    const sourceTotals = new Map<string, number>();

    let totalPaise = 0;
    let thisMonthPaise = 0;
    let thisYearPaise = 0;

    for (const row of rows) {
      const paise = Math.max(0, Math.round(row.paise));
      const rowMonth = monthKey(row.checkIn);
      const rowYear = row.checkIn.getUTCFullYear();
      const property = propertyTotals.get(row.propertyId);

      totalPaise += paise;
      if (rowMonth === thisMonth) thisMonthPaise += paise;
      if (rowYear === thisYear) thisYearPaise += paise;

      propertyTotals.set(row.propertyId, {
        propertyId: row.propertyId,
        label: row.label,
        paise: (property?.paise ?? 0) + paise,
      });
      add(monthTotals, rowMonth, paise);
      yearTotals.set(rowYear, (yearTotals.get(rowYear) ?? 0) + paise);
      add(sourceTotals, row.source, paise);
    }

    const monthly = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(thisYear, now.getUTCMonth() - 11 + index, 1));
      const key = monthKey(date);
      return { month: key, label: monthLabel(date), paise: monthTotals.get(key) ?? 0 };
    });

    return {
      totalPaise,
      thisMonthPaise,
      thisYearPaise,
      bookingsCount: rows.length,
      perProperty: [...propertyTotals.values()].sort((a, b) => b.paise - a.paise),
      monthly,
      yearly: [...yearTotals.entries()]
        .sort(([a], [b]) => a - b)
        .map(([year, paise]) => ({ year, paise })),
      bySource: [...sourceTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([source, paise]) => ({ source, paise })),
    };
  });
}
