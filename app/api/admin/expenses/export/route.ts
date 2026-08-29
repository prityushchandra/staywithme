import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expensesToCsv, filterExpenses } from "@/lib/expenses";
import { listExpenses } from "@/lib/expenses-data";

// CSV of exactly what the viewer is showing — same rows, same order, same
// filters, so the download can't disagree with the screen it came from.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin)
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const rows = filterExpenses(await listExpenses(), {
    listingId: q.get("listingId") ?? undefined,
    type: q.get("type") ?? undefined,
    paidBy: q.get("paidBy") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  // \uFEFF: without the BOM Excel opens UTF-8 as Latin-1 and mangles the ₹ sign
  // and any non-ASCII flat name.
  return new NextResponse(`\uFEFF${expensesToCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
