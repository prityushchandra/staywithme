import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { confirmBooking, cancelBooking } from "@/lib/bookings";
import { approveOnlineBooking, rejectOnlineBooking } from "@/lib/online-bookings";

const schema = z.object({
  action: z.enum(["confirm", "cancel", "approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

// Admin confirms or cancels a booking. Confirm blocks the dates + notifies host
// & guest over WhatsApp; cancel frees the dates + notifies.
//
// "approve"/"reject" are the online (paid) variants: the money has already been
// taken, so approve only flips the status and messages everyone, while reject
// releases the nights WITHOUT a refund, per the stated policy.
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

  const { action, note } = parsed.data;
  const result =
    action === "confirm"
      ? await confirmBooking(id)
      : action === "cancel"
        ? await cancelBooking(id)
        : action === "approve"
          ? await approveOnlineBooking(id)
          : await rejectOnlineBooking(id, note);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
