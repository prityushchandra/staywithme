import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { cleanDays, getDotMonthData, isValidMonth } from "@/lib/dots";
import { todayInIndia } from "@/lib/pnl-compute";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

// Everything the dot marker needs for one month: the days already marked, plus
// what we know about every other day so the host can see which are candidates.
export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!isValidMonth(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });

  return NextResponse.json(await getDotMonthData(month));
}

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // listingId → the day-of-month numbers (1..31) marked as dots that month.
  daysByListing: z.record(z.string(), z.array(z.number().int())).default({}),
});

// Replace a month's dot marks wholesale — the marker always sends the full
// picture for the month, so a day the host un-ticked has to disappear.
export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { month, daysByListing } = parsed.data;
  if (!isValidMonth(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });

  const listings = await prisma.listing.findMany({ select: { id: true } });
  const todayMs = todayInIndia(new Date());

  let total = 0;
  const writes = [];
  for (const { id } of listings) {
    const days = cleanDays(daysByListing[id] ?? [], month, todayMs);
    total += days.length;
    writes.push(
      days.length === 0
        ? prisma.listingDotMonth.deleteMany({ where: { listingId: id, month } })
        : prisma.listingDotMonth.upsert({
            where: { listingId_month: { listingId: id, month } },
            update: { days },
            create: { listingId: id, month, days },
          })
    );
  }
  await prisma.$transaction(writes);

  // The P&L reads dots straight off these rows, and its 30s memo would otherwise
  // hide the change for half a minute after saving.
  clearMemo("admin-pnl");

  return NextResponse.json({ ok: true, month, total });
}
