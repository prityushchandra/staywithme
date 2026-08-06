import { after, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncStaffAttendance } from "@/lib/google-sheets";
import { getPlatformSettings } from "@/lib/settings";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function dateFromInput(input: string) {
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function monthBounds(input: string) {
  const [year, month] = input.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    next: new Date(Date.UTC(year, month, 1)),
  };
}

const attendanceSchema = z.object({
  staffId: z.string().trim().min(1),
  listingId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().nonnegative().optional(),
  note: z.string().trim().max(200).optional(),
});

export async function GET(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  const bounds = month?.match(/^\d{4}-\d{2}$/) ? monthBounds(month) : null;

  const attendance = await prisma.staffAttendance.findMany({
    where: bounds ? { date: { gte: bounds.start, lt: bounds.next } } : undefined,
    include: {
      staff: { select: { id: true, name: true, phone: true } },
      listing: { select: { id: true, title: true, flatNumber: true, block: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: bounds ? undefined : 100,
  });

  return NextResponse.json({ attendance });
}

export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = attendanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid attendance details" },
      { status: 400 }
    );
  }

  const settings = await getPlatformSettings();
  const date = dateFromInput(parsed.data.date);
  const amount = Math.round((parsed.data.amount ?? settings.staffDailyRate / 100) * 100);
  const note = parsed.data.note || null;

  const attendance = await prisma.staffAttendance.upsert({
    where: {
      staffId_listingId_date: {
        staffId: parsed.data.staffId,
        listingId: parsed.data.listingId,
        date,
      },
    },
    update: { amount, note },
    create: {
      staffId: parsed.data.staffId,
      listingId: parsed.data.listingId,
      date,
      amount,
      note,
    },
    include: {
      staff: { select: { name: true } },
      listing: { select: { title: true, flatNumber: true, block: true } },
    },
  });

  after(async () => {
    await syncStaffAttendance({
      date: parsed.data.date,
      staffName: attendance.staff.name,
      listingTitle: attendance.listing.title,
      flat: [attendance.listing.flatNumber, attendance.listing.block].filter(Boolean).join(", "),
      amount,
      note,
    }).catch(() => undefined);
  });

  return NextResponse.json({ attendance });
}
