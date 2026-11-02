import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { GUEST_DOCUMENT_SELECT, guestDocuments } from "./booking-documents";

export const OFFLINE_GUEST_SELECT = GUEST_DOCUMENT_SELECT satisfies Prisma.OfflineBookingGuestSelect;

export const offlineGuestDetailsSchema = z.array(z.object({
  position: z.number().int().min(0).max(49),
  name: z.string().trim().min(1, "Enter each guest's name.").max(120),
})).max(50);

export type OfflineGuestDetail = z.infer<typeof offlineGuestDetailsSchema>[number];

export class OfflineGuestDetailsError extends Error {}

export function normalizeOfflineGuests(
  primaryName: string,
  details: OfflineGuestDetail[] | undefined,
  count: number
): OfflineGuestDetail[] {
  const positions = new Set<number>();
  for (const guest of details ?? []) {
    if (positions.has(guest.position)) {
      throw new OfflineGuestDetailsError("Each guest must have a different position.");
    }
    if (guest.position >= count) {
      throw new OfflineGuestDetailsError("Guest details exceed the booking's guest count.");
    }
    positions.add(guest.position);
  }
  return [{ position: 0, name: primaryName }, ...(details ?? []).filter((guest) => guest.position > 0)];
}

// The caller locks the parent booking first, serializing edits with ID uploads.
export async function saveOfflineGuestDetails(
  tx: Prisma.TransactionClient,
  bookingId: string,
  count: number,
  primaryName: string,
  details: OfflineGuestDetail[] | undefined,
  removeDocumentIds: string[]
) {
  const existing = await tx.offlineBookingGuest.findMany({
    where: { bookingId },
    select: OFFLINE_GUEST_SELECT,
  });
  const removed = new Set(removeDocumentIds);
  const documentIds = new Set(existing.flatMap(guestDocuments).map((doc) => doc.id));
  if (removeDocumentIds.some((id) => !documentIds.has(id))) {
    throw new OfflineGuestDetailsError("A document does not belong to this booking.");
  }
  const normalized = details === undefined ? undefined : normalizeOfflineGuests(primaryName, details, count);
  const positions = normalized && new Set(normalized.map((guest) => guest.position));
  if (existing.some((guest) =>
    guestDocuments(guest).some((doc) => !removed.has(doc.id)) &&
    (guest.position >= count || (positions && !positions.has(guest.position)))
  )) {
    throw new OfflineGuestDetailsError("Remove a guest's ID before removing that guest or reducing the guest count.");
  }

  if (removed.size > 0) {
    await tx.offlineBookingGuestDocument.deleteMany({
      where: { guest: { bookingId }, id: { in: [...removed] } },
    });
    await tx.offlineBookingGuest.updateMany({
      where: { bookingId, id: { in: [...removed] } },
      data: { docData: null, docMime: null, docName: null, docSize: 0 },
    });
  }
  await tx.offlineBookingGuest.deleteMany({
    where: {
      bookingId,
      position: positions ? { notIn: [...positions] } : { gte: count },
    },
  });
  for (const guest of normalized ?? [{ position: 0, name: primaryName }]) {
    await tx.offlineBookingGuest.upsert({
      where: { bookingId_position: { bookingId, position: guest.position } },
      create: { bookingId, ...guest },
      update: { name: guest.name },
    });
  }
}
