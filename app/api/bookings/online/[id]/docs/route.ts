import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DOCUMENT_METADATA_SELECT, GUEST_DOCUMENT_SELECT, guestDocumentGroups, parseGuestUpload } from "@/lib/booking-documents";

export const dynamic = "force-dynamic";
// Uploading a 4 MB scan over a phone connection can be slow.
export const maxDuration = 60;

class DocumentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Lock the owner-scoped unpaid draft so simultaneous uploads/deletes cannot
// assign two guest rows to the same position or mutate a paid booking.
async function loadDraft(tx: Prisma.TransactionClient, bookingId: string, guestId: string) {
  return tx.booking.update({
    where: { id: bookingId, guestId, status: "PENDING", source: "ONLINE" },
    data: { updatedAt: new Date() },
    select: {
      id: true, guests: true,
      idDocs: { select: GUEST_DOCUMENT_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
}

function documentError(error: unknown) {
  if (error instanceof DocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return NextResponse.json({ error: "Unpaid booking not found." }, { status: 404 });
  }
  console.error("[online-bookings] document change failed", {
    code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UNKNOWN",
  });
  return NextResponse.json({ error: "Could not update the attachment. Please retry." }, { status: 500 });
}

// One file per request stays below serverless body limits, even when a guest
// selects several scans. The upload ID makes retries safe after lost responses.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const parsed = await parseGuestUpload(await req.formData().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const guestId = session.user.id;
  const { position, name, uploadId } = parsed;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const booking = await loadDraft(tx, id, guestId);
      if (position >= booking.guests) throw new DocumentError("This guest is outside the booking's guest count.", 400);
      const groups = guestDocumentGroups(booking.idDocs);
      const existing = groups.find((guest) => guest.position === position);
      const guest = existing
        ? await tx.bookingGuest.update({ where: { id: existing.id }, data: { name, position }, select: { id: true } })
        : await tx.bookingGuest.create({ data: { bookingId: id, position, name }, select: { id: true } });
      const document = await tx.bookingGuestDocument.upsert({
        where: { guestId_uploadId: { guestId: guest.id, uploadId } },
        create: { guestId: guest.id, uploadId, ...parsed.data },
        update: {},
        select: DOCUMENT_METADATA_SELECT,
      });
      const covered = new Set(groups.filter((guest) => guest.position < booking.guests && guest.documents.length > 0).map((guest) => guest.position));
      covered.add(position);
      return { doc: { ...document, position, name }, uploaded: covered.size, required: booking.guests };
    });
    revalidatePath("/admin/guest-bookings");
    return NextResponse.json(result);
  } catch (error) {
    return documentError(error);
  }
}

/** DELETE /api/bookings/online/[id]/docs?docId=… — let the guest fix a mistake. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const docId = new URL(req.url).searchParams.get("docId") ?? "";
  if (!docId) return NextResponse.json({ error: "Choose an attachment to remove." }, { status: 400 });
  const guestId = session.user.id;
  try {
    await prisma.$transaction(async (tx) => {
      await loadDraft(tx, id, guestId);
      const removed = await tx.bookingGuestDocument.deleteMany({
        where: { id: docId, guest: { bookingId: id } },
      });
      if (removed.count) return;
      const legacy = await tx.bookingGuest.updateMany({
        where: { id: docId, bookingId: id, docName: { not: null } },
        data: { docData: null, docMime: null, docName: null, docSize: 0 },
      });
      if (!legacy.count) throw new DocumentError("Document not found.", 404);
    });
    revalidatePath("/admin/guest-bookings");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return documentError(error);
  }
}
