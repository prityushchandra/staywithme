import type { Prisma } from "@prisma/client";

export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const ALLOWED_DOC_MIMES = ["image/jpeg", "image/png", "application/pdf"] as const;

export const DOCUMENT_METADATA_SELECT = { id: true, docName: true, docSize: true } as const;
export const GUEST_DOCUMENT_SELECT = {
  id: true, position: true, name: true, docName: true, docSize: true,
  documents: { select: DOCUMENT_METADATA_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.BookingGuestSelect;

export type GuestDocumentMetadata = { id: string; docName: string; docSize: number };
export type GuestDocumentRecord = {
  id: string;
  position: number | null;
  name: string;
  docName: string | null;
  docSize: number;
  documents: readonly GuestDocumentMetadata[];
};

export function guestDocuments(guest: Pick<GuestDocumentRecord, "id" | "docName" | "docSize" | "documents">): GuestDocumentMetadata[] {
  return [
    ...(guest.docName ? [{ id: guest.id, docName: guest.docName, docSize: guest.docSize }] : []),
    ...guest.documents,
  ];
}

// Older online uploads had no position. Keep their stable creation order while
// respecting positions already assigned by the multi-attachment flow.
export function guestDocumentGroups(records: readonly GuestDocumentRecord[]) {
  const used = new Set(records.flatMap((guest) => guest.position === null ? [] : [guest.position]));
  let next = 0;
  return records.map((guest) => {
    let position = guest.position;
    if (position === null) {
      while (used.has(next)) next++;
      position = next++;
      used.add(position);
    }
    return { id: guest.id, position, name: guest.name, documents: guestDocuments(guest) };
  });
}

export function guestDocumentFileError(file: File): string | null {
  if (file.size === 0) return "The attachment is empty.";
  if (!ALLOWED_DOC_MIMES.some((mime) => mime === file.type)) return "Upload a JPG, PNG or PDF.";
  if (file.size > MAX_DOC_BYTES) return "That file is larger than 4 MB.";
  return null;
}

export async function parseGuestUpload(form: FormData | null) {
  const positionValue = form?.get("position");
  const nameValue = form?.get("name");
  const uploadValue = form?.get("uploadId");
  const position = typeof positionValue === "string" && /^\d{1,2}$/.test(positionValue)
    ? Number(positionValue) : -1;
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  if (position < 0 || position >= 50 || !name || name.length > 120) {
    return { ok: false, error: "Choose a valid guest and enter their full name." } as const;
  }
  if (uploadValue !== null && uploadValue !== undefined &&
      (typeof uploadValue !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uploadValue))) {
    return { ok: false, error: "Invalid upload identifier. Please select the file again." } as const;
  }
  const parsed = await parseGuestDocument(form?.get("file") ?? null);
  if (!parsed.ok) return parsed;
  return { ...parsed, position, name, uploadId: uploadValue ?? crypto.randomUUID() };
}

export async function parseGuestDocument(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file." } as const;
  }
  const error = guestDocumentFileError(file);
  if (error) return { ok: false, error } as const;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const startsWith = (signature: readonly number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  const matches =
    (file.type === "image/jpeg" && startsWith([0xff, 0xd8, 0xff])) ||
    (file.type === "image/png" && startsWith([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (file.type === "application/pdf" && startsWith([37, 80, 68, 70, 45]));
  if (!matches) {
    return { ok: false, error: "The file contents must match its JPG, PNG or PDF format." } as const;
  }
  return {
    ok: true,
    data: {
      docData: bytes,
      docMime: file.type,
      docName: file.name.slice(0, 200),
      docSize: bytes.byteLength,
    },
  } as const;
}

type PrivateGuestDocument = {
  docData: Uint8Array | null;
  docMime: string | null;
  docName: string | null;
};

export function privateGuestDocumentResponse(doc: PrivateGuestDocument | null): Response {
  if (!doc?.docData?.byteLength || !doc.docMime || !doc.docName) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = new Uint8Array(doc.docData);
  const filename = encodeURIComponent(doc.docName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return new Response(body, {
    headers: {
      "Content-Type": doc.docMime,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="guest-id"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
