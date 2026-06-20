import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { profileUpdateSchema } from "@/lib/validation";

// Update the signed-in user's own profile (name). Writes straight to the DB;
// the client then refreshes its session so the new name shows everywhere.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = profileUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();

  await prisma.user.update({
    where: { id: session.user.id },
    data: { firstName, lastName, name: `${firstName} ${lastName}` },
  });

  return NextResponse.json({ ok: true, firstName, lastName });
}
