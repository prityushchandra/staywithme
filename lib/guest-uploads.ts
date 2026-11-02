import { guestDocumentFileError, type GuestDocumentMetadata } from "./booking-documents";

export type GuestUpload = { position: number; name: string; file: File; uploadId: string };
export type GuestUploadFailure = { upload: GuestUpload; error: string };
export type UploadedGuestDocument = GuestDocumentMetadata & { position: number; name: string };
export type SavedGuestUpload = UploadedGuestDocument & { uploadId: string };

export function isUploadedGuestDocument(value: unknown): value is UploadedGuestDocument {
  return !!value && typeof value === "object" &&
    "id" in value && typeof value.id === "string" &&
    "position" in value && Number.isInteger(value.position) &&
    "name" in value && typeof value.name === "string" &&
    "docName" in value && typeof value.docName === "string" &&
    "docSize" in value && typeof value.docSize === "number";
}

export async function uploadGuestFiles(
  endpoint: string,
  uploads: readonly GuestUpload[],
  onProgress: (guest: number, current: number, total: number) => void,
  signal?: AbortSignal
) {
  const failed: GuestUploadFailure[] = [];
  const saved: SavedGuestUpload[] = [];
  for (const [index, upload] of uploads.entries()) {
    if (signal?.aborted) {
      failed.push({ upload, error: "Upload cancelled. Please retry." });
      continue;
    }
    onProgress(upload.position + 1, index + 1, uploads.length);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 60_000);
    try {
      const error = guestDocumentFileError(upload.file);
      if (error) throw new Error(error);
      const form = new FormData();
      form.set("position", String(upload.position));
      form.set("name", upload.name);
      form.set("uploadId", upload.uploadId);
      form.set("file", upload.file);
      const response = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : "The attachment upload failed. Please retry.");
      }
      if (!body || typeof body !== "object" || !("doc" in body) ||
          !isUploadedGuestDocument(body.doc) || body.doc.position !== upload.position) {
        throw new Error("The server did not confirm the ID upload. Please retry.");
      }
      saved.push({ ...body.doc, uploadId: upload.uploadId });
    } catch (error) {
      failed.push({
        upload,
        error: controller.signal.aborted
          ? "The upload timed out or was cancelled. Please retry."
          : error instanceof Error ? error.message : "The attachment upload failed. Please retry.",
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return { failed, saved };
}
