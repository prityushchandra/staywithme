import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReceiptFile } from "./receipt-share";

afterEach(() => vi.unstubAllGlobals());

describe("preparing receipt files", () => {
  it("prepares the actual PDF bytes and filename, not a receipt URL", async () => {
    const bytes = "%PDF-1.4\nSynthetic booking receipt";
    const fetchMock = vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const file = await fetchReceiptFile("/api/receipts/booking/example", "Booking-receipt.pdf", controller.signal);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("Booking-receipt.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe(bytes);
    expect(fetchMock).toHaveBeenCalledWith("/api/receipts/booking/example", {
      credentials: "include", cache: "no-store", signal: controller.signal,
    });
  });

  it.each([
    { status: 503, type: "application/pdf", body: "%PDF-error" },
    { status: 200, type: "text/html", body: "<html>Sign in</html>" },
    { status: 200, type: "application/pdf", body: "Not actually a PDF" },
  ])("rejects invalid receipt responses: $status $type", async ({ status, type, body }) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } })));
    await expect(fetchReceiptFile("/receipt", "receipt.pdf", new AbortController().signal)).rejects.toThrow();
  });
});
