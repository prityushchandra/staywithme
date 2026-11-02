import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./share-button";

const mocks = vi.hoisted(() => ({
  share: vi.fn(),
  writeText: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const url = "https://staywithme.co.in/listings/stay-123?checkIn=2026-12-10&checkOut=2026-12-12&guests=2";

async function shareListing() {
  const button: ReactElement<{ onClick: () => Promise<void> }> = ShareButton({ title: "Luxury 1BHK" });
  await button.props.onClick();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { href: url } });
  vi.stubGlobal("navigator", {
    share: mocks.share,
    clipboard: { writeText: mocks.writeText },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("listing sharing", () => {
  it("shares only the listing URL, preserving dates and guests without a title or caption", async () => {
    await shareListing();
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledWith({ url });
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("copies only the same URL if native sharing fails", async () => {
    mocks.share.mockRejectedValue(new Error("Sharing unavailable"));
    await shareListing();
    expect(mocks.writeText).toHaveBeenCalledTimes(1);
    expect(mocks.writeText).toHaveBeenCalledWith(url);
    expect(mocks.toast).toHaveBeenCalledWith("Link copied");
  });

  it("does not copy a link when the user cancels sharing", async () => {
    mocks.share.mockRejectedValue(new DOMException("Canceled", "AbortError"));
    await shareListing();
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
