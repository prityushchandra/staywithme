import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";

async function requireAdmin() {
  const session = await auth();
  return session?.user?.isAdmin ? session : null;
}

const upsertSchema = z.object({
  listingId: z.string().trim().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  amountRupees: z.coerce.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
});

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

// List all recorded monthly online earnings (newest month first).
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const rows = await prisma.onlineEarning.findMany({
    include: { listing: { select: { title: true, flatNumber: true, block: true } } },
    orderBy: [{ month: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({
    earnings: rows.map((r) => ({
      id: r.id,
      listingId: r.listingId,
      label: flatLabel(r.listing),
      month: r.month,
      amount: r.amount,
      note: r.note,
    })),
  });
}

// Record (or overwrite) the online earnings total for a flat in a month.
export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { listingId, month, amountRupees, note } = parsed.data;
  const amount = Math.round(amountRupees * 100);

  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true } });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const row = await prisma.onlineEarning.upsert({
    where: { listingId_month: { listingId, month } },
    create: { listingId, month, amount, note: note || null, createdById: session.user.id },
    update: { amount, note: note || null },
  });
  clearMemo();
  return NextResponse.json({ id: row.id }, { status: 201 });
}

// Delete an entry: /api/admin/online-earnings?id=...
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.onlineEarning.delete({ where: { id } }).catch(() => {});
  clearMemo();
  return NextResponse.json({ ok: true });
}
