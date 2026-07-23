import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
});

const renameSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(40),
});

// Add a society block / tower name (admin only).
export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid block name" },
      { status: 400 }
    );
  }

  const name = parsed.data.name.trim();
  const existing = await prisma.block.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "That block already exists." }, { status: 409 });

  const block = await prisma.block.create({ data: { name } });
  revalidateTag("blocks");
  clearMemo();
  return NextResponse.json({ block }, { status: 201 });
}

// Rename a society block / tower (admin only). The rename cascades to existing
// listings that stored the old name, so guest-facing addresses stay consistent.
export async function PATCH(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid block name" },
      { status: 400 }
    );
  }

  const { id } = parsed.data;
  const name = parsed.data.name.trim();

  const current = await prisma.block.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Block not found." }, { status: 404 });

  // No-op rename (e.g. only case/whitespace changed to the same value).
  if (current.name === name) {
    return NextResponse.json({ block: current });
  }

  const clash = await prisma.block.findUnique({ where: { name } });
  if (clash) return NextResponse.json({ error: "That block already exists." }, { status: 409 });

  const [block] = await prisma.$transaction([
    prisma.block.update({ where: { id }, data: { name } }),
    prisma.listing.updateMany({ where: { block: current.name }, data: { block: name } }),
  ]);

  revalidateTag("blocks");
  clearMemo();
  return NextResponse.json({ block });
}

// Delete a block name (admin only). Existing listings keep their stored block.
export async function DELETE(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.block.delete({ where: { id } }).catch(() => {});
  revalidateTag("blocks");
  clearMemo();
  return NextResponse.json({ ok: true });
}
