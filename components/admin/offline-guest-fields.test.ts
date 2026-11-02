import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyUploadedGuests, offlineGuestDrafts, offlineGuestPayload, uploadOfflineGuestFiles,
  type OfflineGuestDraft,
} from "./offline-guest-fields";

const file = () => new File(["%PDF-1.4\nSynthetic ID"], "sample.pdf", { type: "application/pdf" });
const draft = (position: number, name: string, selected: File | null = null): OfflineGuestDraft => ({
  position, name, files: selected ? [{ file: selected, uploadId: crypto.randomUUID() }] : [],
  documents: [], removeDocumentIds: [],
});
const saved = (position: number) => ({
  id: `doc-${position}`, position, name: `Guest ${position + 1}`, docName: "sample.pdf", docSize: 21,
  documents: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("manual guest upload preparation", () => {
  it("keeps file objects separate from JSON metadata and uses the current primary name", () => {
    const primary = file();
    const companion = file();
    const payload = offlineGuestPayload([
      draft(0, "Old name", primary), draft(1, " Companion ", companion),
    ], 2, "Primary Guest");
    expect(payload.guestDetails).toEqual([
      { position: 0, name: "Primary Guest" }, { position: 1, name: "Companion" },
    ]);
    expect(payload.uploads.map((upload) => upload.file)).toEqual([primary, companion]);
    expect(payload.removeDocumentIds).toEqual([]);
  });

  it("requires the selected ID's guest name but permits names and missing IDs independently", () => {
    expect(() => offlineGuestPayload([draft(1, "", file())], 2, "Primary")).toThrow("Guest 2's full name");
    expect(offlineGuestPayload([], 3, "Primary").uploads).toEqual([]);
    expect(offlineGuestPayload([draft(1, "Companion")], 2, "Primary").guestDetails).toHaveLength(2);
    expect(() => offlineGuestPayload([draft(0, "", new File([], "empty.pdf", { type: "application/pdf" }))], 1, "Primary"))
      .toThrow("empty");
  });

  it("requires explicit ID removal when reducing guest count and retains removal IDs outside the count", () => {
    const guests = offlineGuestDrafts([saved(0), saved(1)]);
    expect(() => offlineGuestPayload(guests, 1, "Primary")).toThrow("Remove IDs");
    const removed = guests.map((guest) => ({ ...guest, removeDocumentIds: guest.position === 1 ? ["doc-1"] : [] }));
    expect(offlineGuestPayload(removed, 1, "Primary")).toMatchObject({
      removeDocumentIds: ["doc-1"], guestDetails: [{ position: 0, name: "Primary" }],
    });
  });
});

describe("per-file manual ID uploads", () => {
  it("preserves successful uploads and retries only the failed guest without another booking request", async () => {
    const positions: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body;
      expect(form).toBeInstanceOf(FormData);
      if (!(form instanceof FormData)) throw new Error("Expected one multipart file");
      const position = String(form.get("position"));
      positions.push(position);
      expect(form.getAll("file")).toHaveLength(1);
      return positions.length === 2
        ? Response.json({ error: "Synthetic temporary failure" }, { status: 503 })
        : Response.json({ doc: saved(Number(position)) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const drafts = [draft(0, "Primary", file()), draft(1, "Companion", file())];
    const { uploads } = offlineGuestPayload(drafts, 2, "Primary");
    const first = await uploadOfflineGuestFiles("synthetic-booking", uploads, vi.fn());
    expect(first.saved.map((guest) => guest.position)).toEqual([0]);
    expect(first.failed.map(({ upload }) => upload.position)).toEqual([1]);
    const updated = applyUploadedGuests(drafts, first.saved);
    expect(updated[0].files).toEqual([]);
    expect(updated[0].documents[0].id).toBe("doc-0");
    expect(updated[1].files[0].file).toBe(drafts[1].files[0].file);
    const retry = await uploadOfflineGuestFiles("synthetic-booking", first.failed.map(({ upload }) => upload), vi.fn());
    expect(retry.failed).toEqual([]);
    expect(positions).toEqual(["0", "1", "1"]);
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/admin/offline-bookings/synthetic-booking/guests")).toBe(true);
  });

  it("reports an unconfirmed successful response instead of discarding the selected file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    const uploads = [{ position: 0, name: "Primary", file: file(), uploadId: crypto.randomUUID() }];
    const result = await uploadOfflineGuestFiles("synthetic", uploads, vi.fn());
    expect(result.saved).toEqual([]);
    expect(result.failed[0].upload.file).toBe(uploads[0].file);
    expect(result.failed[0].error).toContain("did not confirm");
  });

  it("times out a stalled request with an explicit retryable error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const pending = uploadOfflineGuestFiles("synthetic", [{ position: 0, name: "Primary", file: file(), uploadId: crypto.randomUUID() }], vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;
    expect(result.saved).toEqual([]);
    expect(result.failed[0].error).toBe("The upload timed out or was cancelled. Please retry.");
  });

  it("appends multiple files to one guest, retaining old files and retrying only the failed file with its original ID", async () => {
    const guest = offlineGuestDrafts([saved(0)])[0];
    guest.files = [file(), file()].map((file) => ({ file, uploadId: crypto.randomUUID() }));
    const uploadIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (!(init.body instanceof FormData)) throw new Error("Expected form data");
      const uploadId = String(init.body.get("uploadId"));
      uploadIds.push(uploadId);
      if (uploadIds.length === 2) return Response.json({ error: "Temporary failure" }, { status: 503 });
      return Response.json({ doc: { ...saved(0), id: uploadId } });
    }));
    const first = await uploadOfflineGuestFiles("synthetic", offlineGuestPayload([guest], 1, "Primary").uploads, vi.fn());
    const afterFirst = applyUploadedGuests([guest], first.saved);
    expect(afterFirst[0].documents.map((doc) => doc.id)).toEqual(["doc-0", guest.files[0].uploadId]);
    expect(afterFirst[0].files).toEqual([guest.files[1]]);
    const retry = await uploadOfflineGuestFiles("synthetic", first.failed.map(({ upload }) => upload), vi.fn());
    const done = applyUploadedGuests(afterFirst, retry.saved);
    expect(done[0].documents).toHaveLength(3);
    expect(done[0].files).toEqual([]);
    expect(uploadIds).toEqual([guest.files[0].uploadId, guest.files[1].uploadId, guest.files[1].uploadId]);
    expect(applyUploadedGuests(done, retry.saved)[0].documents).toHaveLength(3);
  });

  it("requires all a removed guest's attachments to be explicitly removed", () => {
    const guests = offlineGuestDrafts([{
      ...saved(1), documents: [{ id: "back-scan", docName: "back.pdf", docSize: 21 }],
    }]);
    guests[0].removeDocumentIds = ["doc-1"];
    expect(() => offlineGuestPayload(guests, 1, "Primary")).toThrow("Remove IDs");
    guests[0].removeDocumentIds.push("back-scan");
    expect(offlineGuestPayload(guests, 1, "Primary").removeDocumentIds).toEqual(["doc-1", "back-scan"]);
  });
});
