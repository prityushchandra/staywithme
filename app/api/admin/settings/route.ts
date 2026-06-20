import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clearMemo } from "@/lib/memo";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Platform settings — entered in rupees for prices, stored in paise.
const schema = z.object({
  whatsappNumber: z.string().min(8).max(20),
  platformFeePercent: z.coerce.number().int().min(0).max(100),
  suggestedPriceMinRupees: z.coerce.number().int().min(0).max(10_000_000),
  suggestedPriceMaxRupees: z.coerce.number().int().min(0).max(10_000_000),
  rankWeightView: z.coerce.number().int().min(0).max(100),
  rankWeightSave: z.coerce.number().int().min(0).max(100),
  rankWeightClick: z.coerce.number().int().min(0).max(100),
  reviewsOpenToAll: z.boolean(),
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
      { error: parsed.error.issues[0]?.message ?? "Invalid settings" },
      { status: 400 }
    );
  }
  const d = parsed.data;
  if (d.suggestedPriceMaxRupees < d.suggestedPriceMinRupees) {
    return NextResponse.json(
      { error: "Max suggested price must be ≥ min." },
      { status: 400 }
    );
  }

  // Normalise the WhatsApp number to a leading '+' and digits.
  const digits = d.whatsappNumber.replace(/\D/g, "");
  const whatsappNumber = `+${digits}`;

  await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    update: {
      whatsappNumber,
      platformFeePercent: d.platformFeePercent,
      suggestedPriceMin: d.suggestedPriceMinRupees * 100,
      suggestedPriceMax: d.suggestedPriceMaxRupees * 100,
      rankWeightView: d.rankWeightView,
      rankWeightSave: d.rankWeightSave,
      rankWeightClick: d.rankWeightClick,
      reviewsOpenToAll: d.reviewsOpenToAll,
    },
    create: {
      id: "singleton",
      whatsappNumber,
      platformFeePercent: d.platformFeePercent,
      suggestedPriceMin: d.suggestedPriceMinRupees * 100,
      suggestedPriceMax: d.suggestedPriceMaxRupees * 100,
      rankWeightView: d.rankWeightView,
      rankWeightSave: d.rankWeightSave,
      rankWeightClick: d.rankWeightClick,
      reviewsOpenToAll: d.reviewsOpenToAll,
    },
  });

  revalidateTag("settings");
  revalidateTag("listings");
  clearMemo();
  return NextResponse.json({ ok: true });
}
