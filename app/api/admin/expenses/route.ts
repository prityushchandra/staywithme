import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { dateToUtc, normalizeExpense } from "@/lib/expenses";
import { listExpenses } from "@/lib/expenses-data";

async function requireAdmin() {
  const session = await auth();
  return session?.user?.isAdmin ? session : null;
}

export async function GET() {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return NextResponse.json({ expenses: await listExpenses() });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = normalizeExpense(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const listing = await prisma.listing.findUnique({ where: { id: v.listingId }, select: { id: true } });
  if (!listing) return NextResponse.json({ error: "That flat no longer exists." }, { status: 400 });

  const created = await prisma.expense.create({
    data: {
      listingId: v.listingId,
      type: v.type,
      amount: v.amount,
      date: dateToUtc(v.date),
      month: v.month,
      paidBy: v.paidBy,
      note: v.note,
      createdById: session.user?.id ?? null,
    },
    select: { id: true },
  });

  // The P&L reads expenses directly, and its 30s memo would otherwise hide this
  // for half a minute.
  clearMemo("admin-pnl");
  return NextResponse.json({ ok: true, id: created.id });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing expense id" }, { status: 400 });

  const parsed = normalizeExpense(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const updated = await prisma.expense.updateMany({
    where: { id },
    data: {
      listingId: v.listingId,
      type: v.type,
      amount: v.amount,
      date: dateToUtc(v.date),
      month: v.month,
      paidBy: v.paidBy,
      note: v.note,
    },
  });
  if (updated.count === 0)
    return NextResponse.json({ error: "That expense no longer exists." }, { status: 404 });

  clearMemo("admin-pnl");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing expense id" }, { status: 400 });

  await prisma.expense.deleteMany({ where: { id } });
  clearMemo("admin-pnl");
  return NextResponse.json({ ok: true });
}
