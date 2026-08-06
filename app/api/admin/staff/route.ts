import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
});

export async function GET() {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const staff = await prisma.staff.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return NextResponse.json({ staff });
}

export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid staff details" },
      { status: 400 }
    );
  }

  const staff = await prisma.staff.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
    },
  });

  return NextResponse.json({ staff }, { status: 201 });
}
