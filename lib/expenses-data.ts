import { prisma } from "@/lib/db";
import { utcToDate, type ExpenseRow, type ExpenseType } from "@/lib/expenses";

// Server-only. Kept apart from lib/expenses.ts so the constants and pure helpers
// there stay importable from client components without dragging Prisma in.

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

/** Every expense, newest first, shaped for the viewer. */
export async function listExpenses(): Promise<ExpenseRow[]> {
  const rows = await prisma.expense.findMany({
    include: { listing: { select: { title: true, flatNumber: true, block: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
  });
  return rows.map((e) => ({
    id: e.id,
    listingId: e.listingId,
    label: flatLabel(e.listing),
    type: e.type as ExpenseType,
    amount: e.amount,
    date: utcToDate(e.date),
    month: e.month,
    paidBy: e.paidBy,
    note: e.note,
  }));
}
