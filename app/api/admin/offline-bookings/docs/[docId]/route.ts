import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateGuestDocumentResponse } from "@/lib/booking-documents";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { docId } = await params;
  const select = { docData: true, docMime: true, docName: true } as const;
  const doc = await prisma.offlineBookingGuestDocument.findUnique({
    where: { id: docId }, select,
  }) ?? await prisma.offlineBookingGuest.findUnique({
    where: { id: docId },
    select,
  });
  return privateGuestDocumentResponse(doc);
}
