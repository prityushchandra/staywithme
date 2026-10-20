import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createBooking } from "./route";
import { PATCH } from "./[id]/route";
import { POST as uploadId } from "./[id]/guests/route";
import { GET as readManualId } from "./docs/[docId]/route";
import { GET as readGuestId } from "../bookings/docs/[docId]/route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), addBlock: vi.fn(),
  db: {
    $transaction: vi.fn(),
    listing: { findUnique: vi.fn() },
    offlineBooking: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    offlineBookingGuest: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    bookingGuest: { findUnique: vi.fn() },
    availabilityBlock: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
    receipt: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), after: vi.fn(),
}));
vi.mock("@/lib/memo", () => ({ clearMemo: vi.fn() }));
vi.mock("@/lib/availability", () => ({
  addBlock: mocks.addBlock,
  toUtcDate: (value: string) => new Date(`${value}T00:00:00Z`),
}));
vi.mock("@/lib/receipts", () => ({
  withReceiptNumber: async (save: (number: string) => Promise<unknown>) => ({
    result: await save("SWM-TEST-0001"), receiptNumber: "SWM-TEST-0001",
  }),
}));
vi.mock("@/lib/google-sheets", () => ({ syncOfflineBooking: vi.fn(), syncReceipt: vi.fn() }));

const booking = {
  id: "synthetic-booking", listingId: "synthetic-flat",
  guestName: "Primary Guest", guestPhone: null, guests: 2,
  checkIn: new Date("2025-10-01T00:00:00Z"), checkOut: new Date("2025-10-03T00:00:00Z"),
  totalPrice: 100000, amountPaid: 100000, due: 0, source: "OFFLINE", status: "CONFIRMED",
  blockId: "synthetic-block", publicToken: "synthetic-token", createdAt: new Date("2025-09-01T00:00:00Z"),
  listing: { id: "synthetic-flat", title: "Example flat", flatNumber: "908", block: "B", checkInTime: null, checkOutTime: null },
  receipts: [{ id: "synthetic-receipt" }],
};
const document = { id: "synthetic-doc", position: 1, name: "Companion Guest", docName: "sample.pdf", docSize: 21 };
const params = () => ({ params: Promise.resolve({ id: booking.id }) });
const docParams = () => ({ params: Promise.resolve({ docId: document.id }) });
const pdf = () => new File(["%PDF-1.4\nSynthetic ID"], "sample.pdf", { type: "application/pdf" });

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/offline-bookings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function uploadRequest(position = 1, file = pdf()) {
  const form = new FormData();
  form.set("position", String(position));
  form.set("name", "Companion Guest");
  form.set("file", file);
  return new Request("http://localhost/api/admin/offline-bookings/synthetic-booking/guests", { method: "POST", body: form });
}

const createInput = {
  listingId: booking.listingId, guestName: booking.guestName, guests: 2,
  checkIn: "2025-10-01", checkOut: "2025-10-03", totalPrice: 1000, amountPaid: 1000,
};

beforeEach(() => {
  vi.resetAllMocks();
  const db = mocks.db;
  mocks.auth.mockResolvedValue({ user: { id: "configured-test-admin", isAdmin: true } });
  mocks.addBlock.mockResolvedValue({ ok: true, block: { id: booking.blockId } });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.listing.findUnique.mockResolvedValue(booking.listing);
  db.offlineBooking.findUnique.mockResolvedValue(booking);
  db.offlineBooking.create.mockResolvedValue(booking);
  db.offlineBooking.update.mockImplementation(async ({ data }: { data: Partial<typeof booking> }) => ({ ...booking, ...data }));
  db.offlineBookingGuest.findMany.mockResolvedValue([]);
  db.offlineBookingGuest.findUnique.mockResolvedValue(null);
  db.offlineBookingGuest.upsert.mockResolvedValue(document);
  db.bookingGuest.findUnique.mockResolvedValue(null);
  db.availabilityBlock.findMany.mockResolvedValue([]);
});

describe("manual guest documents are admin-only", () => {
  it.each([null, { user: { id: "guest-account", isAdmin: false } }])(
    "rejects unauthorized uploads, reads and metadata changes before touching the database",
    async (session) => {
      mocks.auth.mockResolvedValue(session);
      expect((await createBooking(jsonRequest(createInput))).status).toBe(403);
      expect((await PATCH(jsonRequest({ guestDetails: [] }), params())).status).toBe(403);
      expect((await uploadId(uploadRequest(), params())).status).toBe(403);
      expect((await readManualId(new Request("http://localhost"), docParams())).status).toBe(403);
      expect((await readGuestId(new Request("http://localhost"), docParams())).status).toBe(403);
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
      expect(mocks.db.offlineBookingGuest.findUnique).not.toHaveBeenCalled();
      expect(mocks.db.bookingGuest.findUnique).not.toHaveBeenCalled();
    }
  );
});

describe("manual booking guest metadata", () => {
  it("creates supplied guest names atomically with the booking, not the availability block", async () => {
    const response = await createBooking(jsonRequest({
      ...createInput, guestDetails: [{ position: 0, name: "Old name" }, { position: 1, name: "Companion" }],
    }));
    expect(response.status).toBe(201);
    expect(mocks.db.offlineBooking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        guestName: "Primary Guest",
        guestDetails: { create: [{ position: 0, name: "Primary Guest" }, { position: 1, name: "Companion" }] },
      }),
    }));
    expect(mocks.addBlock.mock.calls[0][0]).not.toHaveProperty("guestDetails");
    expect(mocks.db.receipt.create).toHaveBeenCalledOnce();
  });

  it("keeps older clients working without companion names or IDs", async () => {
    expect((await createBooking(jsonRequest(createInput))).status).toBe(201);
    expect(mocks.db.offlineBooking.create.mock.calls[0][0].data.guestDetails).toEqual({
      create: [{ position: 0, name: "Primary Guest" }],
    });
  });

  it("rejects invalid guest positions before creating or blocking dates", async () => {
    const response = await createBooking(jsonRequest({
      ...createInput, guestDetails: [{ position: 2, name: "Outside count" }],
    }));
    expect(response.status).toBe(400);
    expect(mocks.addBlock).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not unblock a booking when cancellation includes an invalid guest reduction", async () => {
    mocks.db.offlineBookingGuest.findMany.mockResolvedValue([document]);
    const response = await PATCH(jsonRequest({
      status: "CANCELLED", guests: 1, guestDetails: [{ position: 0, name: "Primary Guest" }],
    }), params());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Remove a guest's ID");
    expect(mocks.db.availabilityBlock.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.receipt.update).not.toHaveBeenCalled();
  });

  it("only clears an explicitly owned ID before deleting a removed guest", async () => {
    mocks.db.offlineBookingGuest.findMany.mockResolvedValue([document]);
    const response = await PATCH(jsonRequest({
      guests: 1, guestDetails: [{ position: 0, name: "Primary Guest" }], removeDocumentIds: [document.id],
    }), params());
    expect(response.status).toBe(200);
    expect(mocks.db.offlineBookingGuest.updateMany).toHaveBeenCalledWith({
      where: { bookingId: booking.id, id: { in: [document.id] } },
      data: { docData: null, docMime: null, docName: null, docSize: 0 },
    });
    expect(mocks.db.offlineBookingGuest.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: booking.id, position: { notIn: [0] } },
    });
    expect(mocks.db.offlineBookingGuest.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.db.offlineBookingGuest.deleteMany.mock.invocationCallOrder[0]);
  });

  it("rejects removing another booking's ID without clearing any documents", async () => {
    mocks.db.offlineBookingGuest.findMany.mockResolvedValue([document]);
    const response = await PATCH(jsonRequest({ removeDocumentIds: ["another-booking-doc"] }), params());
    expect(response.status).toBe(400);
    expect(mocks.db.offlineBookingGuest.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.offlineBookingGuest.deleteMany).not.toHaveBeenCalled();
  });

  it("checks the locked booking's current guest count rather than a stale pre-edit snapshot", async () => {
    mocks.db.offlineBooking.update.mockResolvedValueOnce({ ...booking, guests: 1 });
    const response = await PATCH(jsonRequest({ guestDetails: [{ position: 1, name: "No longer included" }] }), params());
    expect(response.status).toBe(400);
    expect(mocks.db.offlineBookingGuest.upsert).not.toHaveBeenCalled();
  });

  it("still releases the calendar block after a valid cancellation", async () => {
    expect((await PATCH(jsonRequest({ status: "CANCELLED" }), params())).status).toBe(200);
    expect(mocks.db.availabilityBlock.deleteMany).toHaveBeenCalledWith({ where: { id: booking.blockId } });
    expect(mocks.db.$transaction.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.db.availabilityBlock.deleteMany.mock.invocationCallOrder[0]);
  });
});

describe("manual per-guest uploads", () => {
  it("stores one file per guest and returns metadata without exposing document bytes", async () => {
    const response = await uploadId(uploadRequest(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ doc: document });
    const query = mocks.db.offlineBookingGuest.upsert.mock.calls[0][0];
    expect(query.where).toEqual({ bookingId_position: { bookingId: booking.id, position: 1 } });
    expect(query.create.docData).toBeInstanceOf(Uint8Array);
    expect(query.create.docMime).toBe("application/pdf");
    expect(query.update.docData).toEqual(query.create.docData);
    expect(query.select.docData).toBeUndefined();
    expect(mocks.db.offlineBooking.update.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.db.offlineBookingGuest.upsert.mock.invocationCallOrder[0]);
  });

  it("uses the current primary name and the same upsert key when replacing an ID", async () => {
    await uploadId(uploadRequest(0), params());
    await uploadId(uploadRequest(0), params());
    expect(mocks.db.offlineBookingGuest.upsert).toHaveBeenCalledTimes(2);
    for (const [query] of mocks.db.offlineBookingGuest.upsert.mock.calls) {
      expect(query.where).toEqual({ bookingId_position: { bookingId: booking.id, position: 0 } });
      expect(query.create.name).toBe("Primary Guest");
      expect(query.update.name).toBe("Primary Guest");
    }
  });

  it("rejects a forged file before opening a write transaction", async () => {
    const fake = new File(["not a PDF"], "forged.pdf", { type: "application/pdf" });
    expect((await uploadId(uploadRequest(1, fake), params())).status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an upload after the guest count has been reduced", async () => {
    mocks.db.offlineBooking.update.mockResolvedValueOnce({ guests: 1, guestName: booking.guestName });
    expect((await uploadId(uploadRequest(1), params())).status).toBe(400);
    expect(mocks.db.offlineBookingGuest.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 without storing bytes if the booking has been deleted", async () => {
    mocks.db.offlineBooking.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Missing", {
      code: "P2025", clientVersion: "test",
    }));
    expect((await uploadId(uploadRequest(), params())).status).toBe(404);
    expect(mocks.db.offlineBookingGuest.upsert).not.toHaveBeenCalled();
  });
});

describe("private ID reading", () => {
  it("streams only through the authenticated private endpoint, including existing online IDs", async () => {
    const content = { docData: new Uint8Array([37, 80, 68, 70, 45]), docMime: "application/pdf", docName: "sample.pdf" };
    mocks.db.offlineBookingGuest.findUnique.mockResolvedValue(content);
    mocks.db.bookingGuest.findUnique.mockResolvedValue(content);
    for (const read of [readManualId, readGuestId]) {
      const response = await read(new Request("http://localhost"), docParams());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(content.docData);
    }
  });

  it("returns 404 for absent or removed manual IDs", async () => {
    expect((await readManualId(new Request("http://localhost"), docParams())).status).toBe(404);
    mocks.db.offlineBookingGuest.findUnique.mockResolvedValue({ docData: null, docMime: null, docName: null });
    expect((await readManualId(new Request("http://localhost"), docParams())).status).toBe(404);
  });
});
