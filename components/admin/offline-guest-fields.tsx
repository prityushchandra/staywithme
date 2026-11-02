"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookingAttachments } from "@/components/admin/booking-attachments";
import { ALLOWED_DOC_MIMES, guestDocumentFileError, guestDocuments, type GuestDocumentMetadata, type GuestDocumentRecord } from "@/lib/booking-documents";
import { uploadGuestFiles, type GuestUpload, type GuestUploadFailure, type SavedGuestUpload } from "@/lib/guest-uploads";

export type OfflineGuestRecord = GuestDocumentRecord & { position: number };
export type { GuestUpload, GuestUploadFailure } from "@/lib/guest-uploads";

export type OfflineGuestDraft = {
  position: number;
  name: string;
  files: { file: File; uploadId: string }[];
  documents: GuestDocumentMetadata[];
  removeDocumentIds: string[];
};

export function offlineGuestDrafts(records: readonly OfflineGuestRecord[] = []): OfflineGuestDraft[] {
  return records.map((record) => ({
    position: record.position, name: record.name, files: [], documents: guestDocuments(record), removeDocumentIds: [],
  }));
}

function activeGuests(drafts: readonly OfflineGuestDraft[], count: number, primaryName: string): OfflineGuestDraft[] {
  return Array.from({ length: Math.min(50, Math.max(0, count)) }, (_, position) => {
    const existing = drafts.find((guest) => guest.position === position);
    return {
      position, files: [], documents: [], removeDocumentIds: [],
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
    if ((guest.position === 0 || guest.files.length > 0 ||
        guest.documents.some((doc) => !guest.removeDocumentIds.includes(doc.id))) && !guest.name.trim()) {
      throw new Error(`Enter Guest ${guest.position + 1}'s full name.`);
    }
    for (const { file } of guest.files) {
      const error = guestDocumentFileError(file);
      if (error) throw new Error(`Guest ${guest.position + 1} (${file.name}): ${error}`);
    }
  }
  if (drafts.some((guest) => guest.position >= count &&
      guest.documents.some((doc) => !guest.removeDocumentIds.includes(doc.id)))) {
    throw new Error("Remove IDs for guests no longer included before reducing the guest count.");
  }
  return {
    guestDetails: guests.filter((guest) => guest.name.trim()).map((guest) => ({
      position: guest.position, name: guest.name.trim(),
    })),
    removeDocumentIds: drafts.flatMap((guest) => guest.removeDocumentIds),
    uploads: guests.flatMap((guest) => guest.files.map((file) => ({
      ...file, position: guest.position, name: guest.name.trim(),
    }))),
  };
}

export function uploadOfflineGuestFiles(
  bookingId: string,
  uploads: readonly GuestUpload[],
  onProgress: (guest: number, current: number, total: number) => void
) {
  return uploadGuestFiles(`/api/admin/offline-bookings/${encodeURIComponent(bookingId)}/guests`, uploads, onProgress);
}

export function applyUploadedGuests(drafts: readonly OfflineGuestDraft[], saved: readonly SavedGuestUpload[]) {
  const result = [...drafts];
  for (const record of saved) {
    const index = result.findIndex((guest) => guest.position === record.position);
    const current = result[index];
    const document = { id: record.id, docName: record.docName, docSize: record.docSize };
    const guest: OfflineGuestDraft = {
      position: record.position,
      name: record.name,
      files: current?.files.filter((file) => file.uploadId !== record.uploadId) ?? [],
      documents: [...(current?.documents.filter((doc) => doc.id !== record.id) ?? []), document],
      removeDocumentIds: current?.removeDocumentIds ?? [],
    };
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
        Add multiple JPG, PNG or PDF files, up to 4 MB per file. Documents are private and only admins can view them.
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
            {guest.documents.map((doc) => (
              <div key={doc.id} className="space-y-1">
                {guest.removeDocumentIds.includes(doc.id) ? (
                  <p className="break-words text-xs text-amber-700">
                    {doc.docName} will be removed when you save.{" "}
                    <button type="button" disabled={disabled} className="underline" onClick={() => change(guest, {
                      removeDocumentIds: guest.removeDocumentIds.filter((id) => id !== doc.id),
                    })}>Undo</button>
                  </p>
                ) : (
                  <>
                    <BookingAttachments docs={[{ ...doc, name: guest.name, source: "manual" }]} />
                    <button type="button" disabled={disabled} className="text-xs underline"
                      aria-label={`Remove saved attachment ${doc.docName} for Guest ${guest.position + 1}`}
                      onClick={() => change(guest, { removeDocumentIds: [...guest.removeDocumentIds, doc.id] })}>
                      Remove saved attachment
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor={`${prefix}-file-${guest.position}`}>Aadhaar / ID {guest.position + 1}</Label>
              <input
                id={`${prefix}-file-${guest.position}`}
                type="file"
                multiple
                disabled={disabled}
                accept={ALLOWED_DOC_MIMES.join(",")}
                aria-label={`Guest ${guest.position + 1} Aadhaar or ID`}
                className="block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border file:bg-background file:px-2 file:py-2 file:text-xs"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).map((file) => ({ file, uploadId: crypto.randomUUID() }));
                  if (files.length) change(guest, { files: [...guest.files, ...files] });
                  event.target.value = "";
                }}
              />
            </div>
            {guest.files.map(({ file, uploadId }) => (
              <div key={uploadId} className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 break-words">Ready to upload: {file.name}</span>
                <button type="button" disabled={disabled} className="shrink-0 underline"
                  aria-label={`Remove selected attachment ${file.name} for Guest ${guest.position + 1}`}
                  onClick={() => change(guest, { files: guest.files.filter((entry) => entry.uploadId !== uploadId) })}>Clear</button>
              </div>
            ))}
            {guest.files.length === 0 && !guest.documents.some((doc) => !guest.removeDocumentIds.includes(doc.id)) && (
              <p className="text-xs text-muted-foreground">No Aadhaar / ID uploaded.</p>
            )}
          </div>
        ))}
      </div>
      {drafts.filter((guest) => guest.position >= count && guest.documents.length > 0).map((guest) => (
        <div key={guest.position} className="space-y-2 rounded-lg border border-amber-300 p-3 text-xs">
          <p>Guest {guest.position + 1} ({guest.name}) is no longer included in the guest count.</p>
          {guest.documents.every((doc) => guest.removeDocumentIds.includes(doc.id)) ? (
            <p>
              Their attachments will be removed when you save.{" "}
              <button type="button" disabled={disabled} className="underline" onClick={() => change(guest, { removeDocumentIds: [] })}>Undo</button>
            </p>
          ) : (
            <>
              <p>Explicitly remove their saved attachments before reducing the guest count.</p>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => change(guest, {
                files: [], removeDocumentIds: guest.documents.map((doc) => doc.id),
              })}>
                Remove saved attachments for Guest {guest.position + 1}
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
        <p key={upload.uploadId} className="break-words">Guest {upload.position + 1} ({upload.name}), {upload.file.name}: {error}</p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onRetry}>Retry missing uploads</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onContinue}>Continue without missing IDs</Button>
      </div>
    </div>
  );
}
