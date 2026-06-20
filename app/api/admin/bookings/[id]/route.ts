import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { confirmBooking, cancelBooking } from "@/lib/bookings";

const schema = z.object({ action: z.enum(["confirm", "cancel"]) });

// Admin confirms or cancels a booking. Confirm blocks the dates + notifies host
// & guest over WhatsApp; cancel frees the dates + notifies.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const result =
    parsed.data.action === "confirm"
      ? await confirmBooking(id)
      : await cancelBooking(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
