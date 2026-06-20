import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Admin-editable cancellation policy copy (title + description), shown to guests
// on the listing page and at checkout. The money rules behind each policy are
// fixed in code (lib/payouts.ts); only the wording is editable here.
const schema = z.object({
  policies: z
    .array(
      z.object({
        policy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"]),
        title: z.string().trim().min(1, "Title is required").max(80),
        description: z.string().trim().min(1, "Description is required").max(1000),
      })
    )
    .min(1),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  for (const p of parsed.data.policies) {
    await prisma.cancellationPolicyText.upsert({
      where: { policy: p.policy },
      update: { title: p.title, description: p.description },
      create: { policy: p.policy, title: p.title, description: p.description },
    });
  }

  revalidateTag("settings");
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
