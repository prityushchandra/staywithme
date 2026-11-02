import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, DELETE } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    $transaction: vi.fn(),
    booking: { update: vi.fn() },
    bookingGuest: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    bookingGuestDocument: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const guest = { id: "guest-one", position: 0, name: "Primary", docName: null, docSize: 0, documents: [] };
const params = () => ({ params: Promise.resolve({ id: "booking-one" }) });
const pdf = () => new File(["%PDF-1.4\nSynthetic scan"], "scan.pdf", { type: "application/pdf" });
function upload(position = 0, uploadId = crypto.randomUUID(), file = pdf()) {
  const form = new FormData();
  form.set("position", String(position));
  form.set("name", "Primary");
  form.set("uploadId", uploadId);
  form.set("file", file);
  return new Request("http://localhost/api/bookings/online/booking-one/docs", { method: "POST", body: form });
}
const deletion = (id = "doc-one") => new Request(`http://localhost/api/bookings/online/booking-one/docs?docId=${id}`, { method: "DELETE" });
const missing = () => new Prisma.PrismaClientKnownRequestError("Missing", { code: "P2025", clientVersion: "test" });

beforeEach(() => {
  vi.resetAllMocks();
  const db = mocks.db;
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.booking.update.mockResolvedValue({ id: "booking-one", guests: 2, idDocs: [guest] });
  db.bookingGuest.create.mockResolvedValue({ id: "new-guest" });
  db.bookingGuest.update.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  db.bookingGuest.updateMany.mockResolvedValue({ count: 0 });
  db.bookingGuestDocument.deleteMany.mockResolvedValue({ count: 0 });
  const documents = new Map<string, { id: string; docName: string; docSize: number }>();
  db.bookingGuestDocument.upsert.mockImplementation(async (query: {
    where: { guestId_uploadId: { guestId: string; uploadId: string } };
    create: { docName: string; docSize: number };
  }) => {
    const key = JSON.stringify(query.where.guestId_uploadId);
    let document = documents.get(key);
    if (!document) {
      document = { id: `doc-${documents.size + 1}`, docName: query.create.docName, docSize: query.create.docSize };
      documents.set(key, document);
    }
    return document;
  });
});

describe("online guest attachments", () => {
  it("appends several files for one guest and returns the same file on an idempotent retry", async () => {
    const firstId = crypto.randomUUID();
    const first = await (await POST(upload(0, firstId), params())).json();
    const second = await (await POST(upload(0), params())).json();
    const retry = await (await POST(upload(0, firstId), params())).json();
    expect(first.doc.id).not.toBe(second.doc.id);
    expect(retry).toEqual(first);
    expect(first.uploaded).toBe(1);
    expect(second.uploaded).toBe(1);
    expect(second.required).toBe(2);
    expect(first.doc.docData).toBeUndefined();
    expect(mocks.db.bookingGuest.create).not.toHaveBeenCalled();
    for (const [query] of mocks.db.bookingGuestDocument.upsert.mock.calls) {
      expect(query.update).toEqual({});
      expect(query.create.guestId).toBe("guest-one");
      expect(query.create.docData).toBeInstanceOf(Uint8Array);
      expect(query.select.docData).toBeUndefined();
    }
    expect(mocks.db.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "booking-one", guestId: "owner", status: "PENDING", source: "ONLINE" },
    }));
    expect(mocks.db.booking.update.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.db.bookingGuestDocument.upsert.mock.invocationCallOrder[0]);
  });

  it("adds a guest row only when that position has never been used", async () => {
    const response = await POST(upload(1), params());
    expect(response.status).toBe(200);
    expect(mocks.db.bookingGuest.create).toHaveBeenCalledWith({
      data: { bookingId: "booking-one", position: 1, name: "Primary" }, select: { id: true },
    });
  });

  it("keeps existing unpositioned IDs with their original guest when appending a file", async () => {
    mocks.db.booking.update.mockResolvedValue({
      id: "booking-one", guests: 2, idDocs: [
        { ...guest, position: null, docName: "first.pdf" },
        { ...guest, id: "legacy-second", position: null, docName: "second.pdf" },
      ],
    });
    expect((await POST(upload(1), params())).status).toBe(200);
    expect(mocks.db.bookingGuest.update).toHaveBeenCalledWith({
      where: { id: "legacy-second" }, data: { name: "Primary", position: 1 }, select: { id: true },
    });
    expect(mocks.db.bookingGuest.create).not.toHaveBeenCalled();
  });

  it("rejects invalid files and out-of-range guest positions", async () => {
    const forged = new File(["not a PDF"], "forged.pdf", { type: "application/pdf" });
    expect((await POST(upload(0, crypto.randomUUID(), forged), params())).status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect((await POST(upload(2), params())).status).toBe(400);
    expect(mocks.db.bookingGuestDocument.upsert).not.toHaveBeenCalled();
  });

  it("requires sign-in before any upload or deletion", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(upload(), params())).status).toBe(401);
    expect((await DELETE(deletion(), params())).status).toBe(401);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects mutations if the owner-scoped unpaid booking no longer matches", async () => {
    mocks.db.booking.update.mockRejectedValue(missing());
    expect((await POST(upload(), params())).status).toBe(404);
    expect((await DELETE(deletion(), params())).status).toBe(404);
    expect(mocks.db.bookingGuestDocument.upsert).not.toHaveBeenCalled();
    expect(mocks.db.bookingGuestDocument.deleteMany).not.toHaveBeenCalled();
  });
});

describe("individual online attachment removal", () => {
  it("deletes only the specified owned attachment, retaining the guest and other files", async () => {
    mocks.db.bookingGuestDocument.deleteMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(deletion(), params())).status).toBe(200);
    expect(mocks.db.bookingGuestDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: "doc-one", guest: { bookingId: "booking-one" } },
    });
    expect(mocks.db.bookingGuest.updateMany).not.toHaveBeenCalled();
  });

  it("clears a legacy attachment without deleting the guest position or child attachments", async () => {
    mocks.db.bookingGuest.updateMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(deletion("guest-one"), params())).status).toBe(200);
    expect(mocks.db.bookingGuest.updateMany).toHaveBeenCalledWith({
      where: { id: "guest-one", bookingId: "booking-one", docName: { not: null } },
      data: { docData: null, docMime: null, docName: null, docSize: 0 },
    });
  });

  it("does not accept a document outside the owned booking", async () => {
    expect((await DELETE(deletion("other-booking-doc"), params())).status).toBe(404);
    expect(mocks.db.bookingGuestDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: "other-booking-doc", guest: { bookingId: "booking-one" } },
    });
  });
});
