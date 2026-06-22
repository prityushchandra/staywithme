import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { toAmenityKey, AMENITY_ICON_KEYS } from "@/lib/amenity-icons";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const createSchema = z.object({
  label: z.string().trim().min(2).max(40),
  icon: z.enum(AMENITY_ICON_KEYS).optional(),
});

// Add a custom amenity (admin only). Key is derived from the label.
export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid amenity" },
      { status: 400 }
    );
  }

  const key = toAmenityKey(parsed.data.label);
  if (!key) return NextResponse.json({ error: "That label isn't valid." }, { status: 400 });

  const existing = await prisma.amenity.findUnique({ where: { key } });
  if (existing) return NextResponse.json({ error: "That amenity already exists." }, { status: 409 });

  const amenity = await prisma.amenity.create({
    data: { key, label: parsed.data.label.trim(), icon: parsed.data.icon ?? null },
  });

  revalidateTag("amenities");
  clearMemo();
  return NextResponse.json({ amenity }, { status: 201 });
}

// Delete an amenity (admin only). Cascades to listing links via the schema.
export async function DELETE(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.amenity.delete({ where: { id } }).catch(() => {});
  revalidateTag("amenities");
  clearMemo();
  return NextResponse.json({ ok: true });
}
