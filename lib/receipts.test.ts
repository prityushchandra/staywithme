import { describe, it, expect, vi, beforeEach } from "vitest";

const receipt = { findMany: vi.fn() };
vi.mock("./db", () => ({ prisma: { receipt } }));

const { nextReceiptNumber, withReceiptNumber } = await import("./receipts");

const issued = (...numbers: string[]) => numbers.map((number) => ({ number }));
const year = new Date().getFullYear();

beforeEach(() => {
  receipt.findMany.mockReset();
});

describe("nextReceiptNumber", () => {
  it("starts at 0001 when nothing has been issued", async () => {
    receipt.findMany.mockResolvedValue([]);
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0001`);
  });

  it("counts up from the highest number issued", async () => {
    receipt.findMany.mockResolvedValue(issued(`SWM-${year}-0001`, `SWM-${year}-0002`));
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0003`);
  });

  it("skips past numbers freed by a deleted receipt", async () => {
    // The bug that broke every booking: 24 receipts exist but 0025 is the
    // highest, because one was deleted. Counting rows re-issues 0025.
    const rows = issued(
      ...Array.from({ length: 25 }, (_, i) => `SWM-${year}-${String(i + 1).padStart(4, "0")}`)
    ).filter((r) => !r.number.endsWith("0023"));
    expect(rows).toHaveLength(24);

    receipt.findMany.mockResolvedValue(rows);
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0026`);
  });

  it("never reuses a number, however many are deleted", async () => {
    receipt.findMany.mockResolvedValue(issued(`SWM-${year}-0009`));
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0010`);
  });

  it("carries the sequence across a year label change", async () => {
    receipt.findMany.mockResolvedValue(issued("SWM-2025-0041"));
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0042`);
  });

  it("ignores numbers that do not match the format", async () => {
    receipt.findMany.mockResolvedValue(issued("legacy-7", `SWM-${year}-0004`));
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-0005`);
  });

  it("keeps ordering past four digits", async () => {
    receipt.findMany.mockResolvedValue(issued(`SWM-${year}-9999`));
    expect(await nextReceiptNumber()).toBe(`SWM-${year}-10000`);
  });
});

describe("withReceiptNumber", () => {
  const duplicate = Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["number"] },
  });

  it("returns the number it saved under", async () => {
    receipt.findMany.mockResolvedValue(issued(`SWM-${year}-0002`));
    const { result, receiptNumber } = await withReceiptNumber(async (n) => `saved ${n}`);
    expect(receiptNumber).toBe(`SWM-${year}-0003`);
    expect(result).toBe(`saved SWM-${year}-0003`);
  });

  it("retries when another write claimed the number first", async () => {
    receipt.findMany
      .mockResolvedValueOnce(issued(`SWM-${year}-0002`))
      .mockResolvedValueOnce(issued(`SWM-${year}-0003`));

    const save = vi.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce("ok");
    const { result, receiptNumber } = await withReceiptNumber(save);

    expect(save).toHaveBeenCalledTimes(2);
    expect(receiptNumber).toBe(`SWM-${year}-0004`);
    expect(result).toBe("ok");
  });

  it("gives up after repeated collisions", async () => {
    receipt.findMany.mockResolvedValue(issued(`SWM-${year}-0002`));
    const save = vi.fn().mockRejectedValue(duplicate);
    await expect(withReceiptNumber(save)).rejects.toBe(duplicate);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("does not retry unrelated failures", async () => {
    receipt.findMany.mockResolvedValue([]);
    const boom = new Error("connection lost");
    const save = vi.fn().mockRejectedValue(boom);
    await expect(withReceiptNumber(save)).rejects.toBe(boom);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not retry a unique violation on a different column", async () => {
    receipt.findMany.mockResolvedValue([]);
    const other = Object.assign(new Error("dupe"), { code: "P2002", meta: { target: ["publicToken"] } });
    const save = vi.fn().mockRejectedValue(other);
    await expect(withReceiptNumber(save)).rejects.toBe(other);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
