import { describe, expect, it } from "vitest";
import { guestDocumentGroups, MAX_DOC_BYTES, parseGuestDocument, parseGuestUpload, privateGuestDocumentResponse } from "./booking-documents";

describe("guest ID validation", () => {
  it.each([
    { type: "image/jpeg", name: "sample.jpg", bytes: [255, 216, 255, 0] },
    { type: "image/png", name: "sample.png", bytes: [137, 80, 78, 71, 13, 10, 26, 10] },
    { type: "application/pdf", name: "sample.pdf", bytes: [37, 80, 68, 70, 45, 49] },
  ])("accepts a matching $type file and preserves its bytes", async ({ type, name, bytes }) => {
    const result = await parseGuestDocument(new File([new Uint8Array(bytes)], name, { type }));
    expect(result).toEqual({
      ok: true,
      data: { docData: new Uint8Array(bytes), docMime: type, docName: name, docSize: bytes.length },
    });
  });

  describe("guest attachment grouping", () => {
    it("keeps legacy files alongside new files and assigns unpositioned guests to unused positions", () => {
      const groups = guestDocumentGroups([
        {
          id: "legacy-one", position: null, name: "First", docName: "front.pdf", docSize: 10,
          documents: [{ id: "extra", docName: "back.pdf", docSize: 12 }],
        },
        { id: "new-guest", position: 1, name: "Second", docName: null, docSize: 0, documents: [] },
        { id: "legacy-two", position: null, name: "Third", docName: "scan.pdf", docSize: 10, documents: [] },
      ]);
      expect(groups.map((guest) => guest.position)).toEqual([0, 1, 2]);
      expect(groups[0].documents.map((doc) => doc.id)).toEqual(["legacy-one", "extra"]);
      expect(groups[1].documents).toEqual([]);
    });

    it("validates upload identities and guest positions before accepting bytes", async () => {
      const form = new FormData();
      form.set("position", "0");
      form.set("name", "Primary");
      form.set("file", new File(["%PDF-1.4"], "id.pdf", { type: "application/pdf" }));
      form.set("uploadId", "not-an-upload-id");
      expect((await parseGuestUpload(form)).ok).toBe(false);
      const uploadId = crypto.randomUUID();
      form.set("uploadId", uploadId);
      expect(await parseGuestUpload(form)).toMatchObject({ ok: true, position: 0, uploadId });
      form.set("position", "50");
      expect((await parseGuestUpload(form)).ok).toBe(false);
    });
  });

  it("rejects empty files, unsupported types and files disguised as an allowed type", async () => {
    for (const file of [
      null,
      new File([], "empty.pdf", { type: "application/pdf" }),
      new File(["<svg />"], "id.svg", { type: "image/svg+xml" }),
      new File(["<html>not a PDF</html>"], "fake.pdf", { type: "application/pdf" }),
    ]) {
      expect((await parseGuestDocument(file)).ok).toBe(false);
    }
  });

  it("accepts exactly 4 MB but rejects a file one byte over the limit", async () => {
    const bytes = new Uint8Array(MAX_DOC_BYTES);
    bytes.set([37, 80, 68, 70, 45]);
    expect((await parseGuestDocument(new File([bytes], "limit.pdf", { type: "application/pdf" }))).ok).toBe(true);
    const oversized = new File([bytes, "x"], "too-large.pdf", { type: "application/pdf" });
    expect(await parseGuestDocument(oversized)).toEqual({
      ok: false, error: "That file is larger than 4 MB.",
    });
  });
});

describe("private guest ID responses", () => {
  it("returns the original bytes with no-store headers and a safe Unicode filename", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const name = "\u0906\u0927\u093e\u0930 (1).pdf";
    const response = privateGuestDocumentResponse({ docData: bytes, docMime: "application/pdf", docName: name });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    const encoded = response.headers.get("content-disposition")!.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe(name);
  });

  it("returns 404 for missing or explicitly removed IDs", () => {
    expect(privateGuestDocumentResponse(null).status).toBe(404);
    expect(privateGuestDocumentResponse({ docData: null, docMime: null, docName: null }).status).toBe(404);
  });
});
