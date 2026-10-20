"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookingAttachments } from "@/components/admin/booking-attachments";
import { ALLOWED_DOC_MIMES, MAX_DOC_BYTES } from "@/lib/booking-documents";

export type OfflineGuestRecord = {
  id: string;
  position: number;
  name: string;
  docName: string | null;
  docSize: number;
};

export type OfflineGuestDraft = {
  position: number;
  name: string;
  file: File | null;
  document: OfflineGuestRecord | null;
  removeDocument: boolean;
};

export type GuestUpload = { position: number; name: string; file: File };
export type GuestUploadFailure = { upload: GuestUpload; error: string };

export function offlineGuestDrafts(records: readonly OfflineGuestRecord[] = []): OfflineGuestDraft[] {
  return records.map((record) => ({
    position: record.position, name: record.name, file: null, document: record, removeDocument: false,
  }));
}

function activeGuests(drafts: readonly OfflineGuestDraft[], count: number, primaryName: string) {
  return Array.from({ length: Math.min(50, Math.max(0, count)) }, (_, position) => {
    const existing = drafts.find((guest) => guest.position === position);
    return {
      position, file: null, document: null, removeDocument: false,
      ...existing,
      name: position === 0 ? primaryName : existing?.name ?? "",
    };
  });
}

export function offlineGuestPayload(
  drafts: readonly OfflineGuestDraft[],
  count: number,
  primaryName: string
) {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("Choose between 1 and 50 guests.");
  }
  const guests = activeGuests(drafts, count, primaryName);
  for (const guest of guests) {
    if ((guest.position === 0 || guest.file || (guest.document?.docName && !guest.removeDocument)) && !guest.name.trim()) {
      throw new Error(`Enter Guest ${guest.position + 1}'s full name.`);
    }
    if (guest.file && !ALLOWED_DOC_MIMES.some((mime) => mime === guest.file?.type)) {
      throw new Error(`Guest ${guest.position + 1}: upload a JPG, PNG or PDF.`);
    }
    if (guest.file?.size === 0) {
      throw new Error(`Guest ${guest.position + 1}'s ID file is empty.`);
    }
    if (guest.file && guest.file.size > MAX_DOC_BYTES) {
      throw new Error(`Guest ${guest.position + 1}'s ID is larger than 4 MB.`);
    }
  }
  if (drafts.some((guest) => guest.position >= count && guest.document?.docName && !guest.removeDocument)) {
    throw new Error("Remove IDs for guests no longer included before reducing the guest count.");
  }
  return {
    guestDetails: guests.filter((guest) => guest.name.trim()).map((guest) => ({
      position: guest.position, name: guest.name.trim(),
    })),
    removeDocumentIds: drafts.filter((guest) => guest.removeDocument && guest.document?.docName)
      .flatMap((guest) => guest.document ? [guest.document.id] : []),
    uploads: guests.flatMap((guest) => guest.file
      ? [{ position: guest.position, name: guest.name.trim(), file: guest.file }] : []),
  };
}

function isGuestRecord(value: unknown): value is OfflineGuestRecord {
  if (!value || typeof value !== "object") return false;
  return "id" in value && typeof value.id === "string" &&
    "position" in value && typeof value.position === "number" &&
    "name" in value && typeof value.name === "string" &&
    "docName" in value && typeof value.docName === "string" &&
    "docSize" in value && typeof value.docSize === "number";
}

export async function uploadOfflineGuestFiles(
  bookingId: string,
  uploads: readonly GuestUpload[],
  onProgress: (guest: number, current: number, total: number) => void
) {
  const failed: GuestUploadFailure[] = [];
  const saved: OfflineGuestRecord[] = [];
  for (const [index, upload] of uploads.entries()) {
    onProgress(upload.position + 1, index + 1, uploads.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const form = new FormData();
      form.set("position", String(upload.position));
      form.set("name", upload.name);
      form.set("file", upload.file);
      const response = await fetch(`/api/admin/offline-bookings/${encodeURIComponent(bookingId)}/guests`, {
        method: "POST", body: form, signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : "The ID upload failed. Please retry.";
        throw new Error(message);
      }
      if (!body || typeof body !== "object" || !("doc" in body) || !isGuestRecord(body.doc)) {
        throw new Error("The server did not confirm the ID upload. Please retry.");
      }
      saved.push(body.doc);
    } catch (error) {
      failed.push({
        upload,
        error: controller.signal.aborted
          ? "The upload timed out. Please retry."
          : error instanceof Error ? error.message : "The ID upload failed. Please retry.",
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return { failed, saved };
}

export function applyUploadedGuests(drafts: readonly OfflineGuestDraft[], saved: readonly OfflineGuestRecord[]) {
  const result = [...drafts];
  for (const record of saved) {
    const index = result.findIndex((guest) => guest.position === record.position);
    const guest = { position: record.position, name: record.name, file: null, document: record, removeDocument: false };
    if (index < 0) result.push(guest);
    else result[index] = guest;
  }
  return result;
}

export function OfflineGuestFields({
  drafts, count, primaryName, onChange, disabled,
}: {
  drafts: readonly OfflineGuestDraft[];
  count: number;
  primaryName: string;
  onChange: (drafts: OfflineGuestDraft[]) => void;
  disabled: boolean;
}) {
  const prefix = useId();
  const guests = activeGuests(drafts, count, primaryName);
  function change(guest: OfflineGuestDraft, patch: Partial<OfflineGuestDraft>) {
    const next = { ...guest, ...patch };
    const exists = drafts.some((item) => item.position === guest.position);
    onChange(exists ? drafts.map((item) => item.position === guest.position ? next : item) : [...drafts, next]);
  }
  return (
    <fieldset className="space-y-3 rounded-xl border bg-muted/10 p-4">
      <legend className="px-1 text-sm font-semibold">Guest details &amp; Aadhaar</legend>
      <p className="text-xs text-muted-foreground">
        Optional: add every guest&apos;s name and Aadhaar / government ID.
        JPG, PNG or PDF, up to 4 MB per guest. Documents are private and only admins can view them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {guests.map((guest) => (
          <div key={guest.position} className="min-w-0 space-y-2 rounded-xl border bg-background p-3">
            <p className="text-sm font-medium">Guest {guest.position + 1}{guest.position === 0 ? " (primary)" : ""}</p>
            {guest.position === 0 ? (
              <p className="break-words text-sm text-muted-foreground">{primaryName.trim() || "Enter the primary guest name above."}</p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor={`${prefix}-name-${guest.position}`}>Full name</Label>
                <Input
                  id={`${prefix}-name-${guest.position}`}
                  aria-label={`Guest ${guest.position + 1} full name`}
                  value={guest.name}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(event) => change(guest, { name: event.target.value })}
                />
              </div>
            )}
            {guest.document?.docName && !guest.removeDocument && (
              <div className="space-y-2">
                <BookingAttachments docs={[{
                  id: guest.document.id, name: guest.name || guest.document.name,
                  docName: guest.document.docName, source: "manual",
                }]} />
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => change(guest, { file: null, removeDocument: true })}>
                  Remove saved ID
                </Button>
              </div>
            )}
            {guest.removeDocument && (
              <div className="text-xs text-amber-700">
                ID will be removed when you save.{" "}
                <button type="button" disabled={disabled} className="underline" onClick={() => change(guest, { removeDocument: false })}>Undo</button>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`${prefix}-file-${guest.position}`}>Aadhaar / ID {guest.position + 1}</Label>
              <input
                id={`${prefix}-file-${guest.position}`}
                type="file"
                disabled={disabled}
                accept={ALLOWED_DOC_MIMES.join(",")}
                aria-label={`Guest ${guest.position + 1} Aadhaar or ID`}
                className="block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border file:bg-background file:px-2 file:py-2 file:text-xs"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) change(guest, { file, removeDocument: false });
                  event.target.value = "";
                }}
              />
            </div>
            {guest.file ? (
              <div className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 break-words">Ready to upload: {guest.file.name}</span>
                <button type="button" disabled={disabled} className="shrink-0 underline" onClick={() => change(guest, { file: null })}>Clear</button>
              </div>
            ) : !guest.document?.docName && (
              <p className="text-xs text-muted-foreground">No Aadhaar / ID uploaded.</p>
            )}
          </div>
        ))}
      </div>
      {drafts.filter((guest) => guest.position >= count && guest.document?.docName).map((guest) => (
        <div key={guest.position} className="space-y-2 rounded-lg border border-amber-300 p-3 text-xs">
          <p>Guest {guest.position + 1} ({guest.name}) is no longer included in the guest count.</p>
          {guest.removeDocument ? (
            <p>
              Their ID will be removed when you save.{" "}
              <button type="button" disabled={disabled} className="underline" onClick={() => change(guest, { removeDocument: false })}>Undo</button>
            </p>
          ) : (
            <>
              <p>Explicitly remove their saved ID before reducing the guest count.</p>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => change(guest, { file: null, removeDocument: true })}>
                Remove saved ID for Guest {guest.position + 1}
              </Button>
            </>
          )}
        </div>
      ))}
    </fieldset>
  );
}

export function GuestUploadErrors({
  failed, busy, onRetry, onContinue,
}: {
  failed: readonly GuestUploadFailure[];
  busy: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  if (failed.length === 0) return null;
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Booking saved, but some IDs could not be uploaded.</p>
      <p>Do not record the booking again. Retry only the missing uploads, or add these IDs later using Edit.</p>
      {failed.map(({ upload, error }) => (
        <p key={upload.position}>Guest {upload.position + 1} ({upload.name}): {error}</p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onRetry}>Retry missing uploads</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onContinue}>Continue without missing IDs</Button>
      </div>
    </div>
  );
}
