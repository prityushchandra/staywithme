import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateGuestDocumentResponse } from "@/lib/booking-documents";

// Reads raw bytes out of the database — never cache, never prerender.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bookings/docs/[docId] — stream one guest ID document.
 *
 * This is the ONLY way the bytes ever leave the database, and it is admin-only.
 * The response is marked no-store and Content-Disposition: inline so the admin
 * can eyeball the card without it landing in a shared cache or a CDN.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { docId } = await params;
  const doc = await prisma.bookingGuest.findUnique({
    where: { id: docId },
    select: { docData: true, docMime: true, docName: true },
  });
  return privateGuestDocumentResponse(doc);
}
