import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

// Remove a monthly payroll entry.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { id } = await params;
  await prisma.staffPayroll.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
