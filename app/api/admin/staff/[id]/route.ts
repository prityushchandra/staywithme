import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    active: z.boolean().optional(),
    monthlySalaryRupees: z.coerce.number().int().min(0).max(10_000_000).optional(),
    allowedLeaves: z.coerce.number().int().min(0).max(200).optional(),
    numberOfFlats: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.phone !== undefined ||
      data.active !== undefined ||
      data.monthlySalaryRupees !== undefined ||
      data.allowedLeaves !== undefined ||
      data.numberOfFlats !== undefined,
    { message: "No changes supplied" }
  );

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid staff details" },
      { status: 400 }
    );
  }

  const staff = await prisma.staff.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.monthlySalaryRupees !== undefined
        ? { monthlySalary: parsed.data.monthlySalaryRupees * 100 }
        : {}),
      ...(parsed.data.allowedLeaves !== undefined ? { allowedLeaves: parsed.data.allowedLeaves } : {}),
      ...(parsed.data.numberOfFlats !== undefined ? { numberOfFlats: parsed.data.numberOfFlats } : {}),
    },
  });

  return NextResponse.json({ staff });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const { id } = await params;
  try {
    await prisma.staff.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not remove staff. Deactivate staff with attendance history instead." },
      { status: 409 }
    );
  }
}
