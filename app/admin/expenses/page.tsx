import { ExpenseTracker } from "@/components/admin/expense-tracker";
import { prisma } from "@/lib/db";
import { listExpenses } from "@/lib/expenses-data";
import { todayInIndia } from "@/lib/pnl-compute";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Expense tracker" };

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export default async function AdminExpensesPage() {
  const [listings, expenses] = await Promise.all([
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
    }),
    listExpenses(),
  ]);

  const flats = listings
    .map((l) => ({ id: l.id, label: flatLabel(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Default the date box to today in India, not the server's idea of today.
  const today = new Date(todayInIndia(new Date())).toISOString().slice(0, 10);

  return <ExpenseTracker flats={flats} expenses={expenses} today={today} />;
}
