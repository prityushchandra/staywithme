import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const listings = await prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, isVisible: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ listings }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
