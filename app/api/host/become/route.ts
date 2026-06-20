import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Opt into hosting: adds the HOST role to the current user's account.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roles: true },
  });
  const roles = new Set(user?.roles ?? ["GUEST"]);
  roles.add("GUEST");
  roles.add("HOST");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { roles: Array.from(roles) },
  });

  return NextResponse.json({ ok: true });
}
