import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  action: z.enum(["suspend", "unsuspend", "promote", "demote", "grant-host"]),
});

// Self-protection: an admin may not suspend/demote/delete their own account.
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

  const isSelf = id === session.user.id;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  switch (parsed.data.action) {
    case "suspend":
      if (isSelf) return NextResponse.json({ error: "You can't suspend yourself." }, { status: 400 });
      await prisma.user.update({ where: { id }, data: { suspended: true } });
      break;
    case "unsuspend":
      await prisma.user.update({ where: { id }, data: { suspended: false } });
      break;
    case "promote":
      await prisma.user.update({ where: { id }, data: { isAdmin: true } });
      break;
    case "demote":
      if (isSelf) return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
      await prisma.user.update({ where: { id }, data: { isAdmin: false } });
      break;
    case "grant-host": {
      const roles = new Set(target.roles);
      roles.add("GUEST");
      roles.add("HOST");
      await prisma.user.update({ where: { id }, data: { roles: Array.from(roles) } });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
