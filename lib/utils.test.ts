import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./utils";

function withReducedMotion(reduce: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: reduce && query.includes("reduce") }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrollBehavior", () => {
  // `globals.css` sets `scroll-behavior: smooth`, so "auto" would animate and
  // the caller's follow-up `scrollY` read would capture the pre-scroll offset.
  it("never returns auto, because auto defers to the global smooth CSS", () => {
    withReducedMotion(false);
    expect(scrollBehavior(true)).not.toBe("auto");
    expect(scrollBehavior(false)).not.toBe("auto");
  });

  it("jumps instantly when the caller opts out of animation", () => {
    withReducedMotion(false);
    expect(scrollBehavior(false)).toBe("instant");
  });

  it("animates when asked and the guest allows motion", () => {
    withReducedMotion(false);
    expect(scrollBehavior(true)).toBe("smooth");
  });

  it("jumps instantly when the guest asked for reduced motion", () => {
    withReducedMotion(true);
    expect(scrollBehavior(true)).toBe("instant");
  });
});
