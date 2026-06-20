import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
});

// Admin moderation actions on a review.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  await prisma.review.update({
    where: { id },
    data: { status: parsed.data.action === "approve" ? "APPROVED" : "REJECTED" },
  });

  // Approving/rejecting changes public rating aggregates.
  revalidateTag("reviews");
  clearMemo();
  return NextResponse.json({ ok: true });
}
