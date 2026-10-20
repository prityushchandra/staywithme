export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const ALLOWED_DOC_MIMES = ["image/jpeg", "image/png", "application/pdf"] as const;

export async function parseGuestDocument(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file." } as const;
  }
  if (!ALLOWED_DOC_MIMES.some((mime) => mime === file.type)) {
    return { ok: false, error: "Upload a JPG, PNG or PDF." } as const;
  }
  if (file.size > MAX_DOC_BYTES) {
    return { ok: false, error: "That file is larger than 4 MB." } as const;
  }

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
