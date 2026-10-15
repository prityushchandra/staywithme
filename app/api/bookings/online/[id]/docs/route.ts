import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ALLOWED_DOC_MIMES, MAX_DOC_BYTES } from "@/lib/online-bookings";

export const dynamic = "force-dynamic";
// Uploading a 4 MB scan over a phone connection can be slow.
export const maxDuration = 60;

/** Only the owner of a still-unpaid draft may touch its documents. */
async function loadDraft(bookingId: string, guestId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, guestId, status: "PENDING" },
    select: { id: true, guests: true, _count: { select: { idDocs: true } } },
  });
}

/**
 * POST /api/bookings/online/[id]/docs — attach one guest's ID.
 *
 * One file per request (multipart), so a four-guest booking never has to push
 * 16 MB through a single serverless invocation. The bytes are stored in our own
 * database and are readable only through the admin-authenticated download route
 * — an Aadhaar card must never acquire a public URL.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const booking = await loadDraft(id, session.user.id);
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (booking._count.idDocs >= booking.guests) {
    return NextResponse.json(
      { error: "You've already uploaded an ID for every guest." },
      { status: 400 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const name = String(form?.get("name") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose a file." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Please enter the guest's name." }, { status: 400 });
  }
  if (!ALLOWED_DOC_MIMES.includes(file.type as (typeof ALLOWED_DOC_MIMES)[number])) {
    return NextResponse.json({ error: "Upload a JPG, PNG or PDF." }, { status: 400 });
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json({ error: "That file is larger than 4 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const doc = await prisma.bookingGuest.create({
    data: {
      bookingId: booking.id,
      name: name.slice(0, 120),
      docData: bytes,
      docMime: file.type,
      docName: file.name.slice(0, 200),
      docSize: bytes.length,
    },
    select: { id: true, name: true, docName: true, docSize: true },
  });

  return NextResponse.json({ doc, uploaded: booking._count.idDocs + 1, required: booking.guests });
}

/** DELETE /api/bookings/online/[id]/docs?docId=… — let the guest fix a mistake. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const booking = await loadDraft(id, session.user.id);
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const docId = new URL(req.url).searchParams.get("docId") ?? "";
  const { count } = await prisma.bookingGuest.deleteMany({
    where: { id: docId, bookingId: booking.id },
  });
  if (!count) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
