import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_HISTORY_BOOTSTRAP } from "./overlay-history-events";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);

vi.mock("react", () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));

let browser: EventTarget;
let history: {
  state: { __NA: boolean; overlay?: string };
  scrollRestoration: ScrollRestoration;
  pushState: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
  back: ReturnType<typeof vi.fn>;
};
let cleanups: Array<() => void>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  effects.length = 0;
  cleanups = [];
  history = {
    state: { __NA: true },
    scrollRestoration: "auto",
    pushState: vi.fn(),
    replaceState: vi.fn(),
    back: vi.fn(),
  };
  history.pushState.mockImplementation((state) => {
    history.state = structuredClone(state);
  });
  browser = Object.assign(new EventTarget(), {
    history,
    location: { href: "https://example.test/search?guests=1" },
  });
  vi.stubGlobal("window", browser);
  new Function(OVERLAY_HISTORY_BOOTSTRAP)();
});

afterEach(() => {
  cleanups.toReversed().forEach((cleanup) => cleanup());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountOverlay(close = vi.fn()) {
  const { useOverlayHistory } = await import("./use-overlay-history");
  const previousState = history.state;
  const replaceOnClose = useOverlayHistory(true, close);
  // Keep the close cleanup separate from unmount so the navigation race can
  // be reproduced deterministically without a DOM renderer.
  const mounted = effects.splice(0).map((setup) => setup());
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    mounted.at(-1)?.();
  };
  cleanups.push(cleanup);
  const pop = () => {
    history.state = previousState;
    browser.dispatchEvent(Object.assign(new Event("popstate"), { state: previousState }));
  };
  return { close, replaceOnClose, cleanup, pop };
}

describe("useOverlayHistory", () => {
  it("does not undo a route replacing the overlay entry when the sheet closes", async () => {
    const overlay = await mountOverlay();

    overlay.replaceOnClose(() =>
      history.replaceState({}, "", "/search?maxPrice=1")
    );
    overlay.cleanup();

    expect(history.replaceState).toHaveBeenCalledWith({}, "", "/search?maxPrice=1");
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(history.back).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("still removes its throwaway entry when closed without navigation", async () => {
    const overlay = await mountOverlay();
    overlay.cleanup();

    expect(history.back).toHaveBeenCalledOnce();
    overlay.pop();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("closes on browser Back without going back a second time", async () => {
    const overlay = await mountOverlay();
    overlay.pop();
    overlay.cleanup();

    expect(overlay.close).toHaveBeenCalledOnce();
    expect(history.back).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("keeps the filter sheet open when a nested calendar closes", async () => {
    const sheet = await mountOverlay();
    const calendar = await mountOverlay();

    calendar.cleanup();
    calendar.pop();
    expect(sheet.close).not.toHaveBeenCalled();

    sheet.pop();
    expect(sheet.close).toHaveBeenCalledOnce();
    sheet.cleanup();
    expect(history.back).toHaveBeenCalledOnce();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("waits for a nested traversal without letting an overlay pop interrupt Next's router", async () => {
    const actions: string[] = [];
    // Next can hydrate before the route's overlay hook module is loaded.
    browser.addEventListener("popstate", () => actions.push("restore"));
    const sheet = await mountOverlay();
    const calendar = await mountOverlay();
    calendar.cleanup();

    sheet.replaceOnClose(() => actions.push("replace"));
    expect(actions).toEqual([]);
    expect(sheet.close).not.toHaveBeenCalled();

    // Scroll fallback is not permission to navigate before a slow Back arrives.
    vi.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(actions).toEqual([]);

    calendar.pop();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions).toEqual(["replace"]);
    expect(sheet.close).toHaveBeenCalledOnce();
    sheet.cleanup();
    expect(history.back).toHaveBeenCalledOnce();
    expect(history.scrollRestoration).toBe("auto");

    // A subsequent real page Back still reaches the router.
    browser.dispatchEvent(Object.assign(new Event("popstate"), {
      state: { __NA: true },
    }));
    expect(actions).toEqual(["replace", "restore"]);
  });

  it("does not apply a queued replacement after the sheet has been dismissed", async () => {
    const sheet = await mountOverlay();
    const calendar = await mountOverlay();
    const replace = vi.fn();
    calendar.cleanup();
    sheet.replaceOnClose(replace);
    sheet.cleanup();

    calendar.pop();
    sheet.pop();
    await Promise.resolve();
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("does not mistake a different history entry for a pending calendar close", async () => {
    const restore = vi.fn();
    browser.addEventListener("popstate", restore);
    const sheet = await mountOverlay();
    const calendar = await mountOverlay();
    calendar.cleanup();

    browser.dispatchEvent(Object.assign(new Event("popstate"), {
      state: { __NA: true, overlay: "a-different-entry" },
    }));

    expect(sheet.close).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    sheet.cleanup();
    calendar.pop();
  });

  it("lets a different route reach Next even when its parent marker matches", async () => {
    const restore = vi.fn();
    browser.addEventListener("popstate", restore);
    const overlay = await mountOverlay();

    window.location.href = "https://example.test/";
    overlay.pop();
    overlay.cleanup();

    expect(restore).toHaveBeenCalledOnce();
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(history.back).not.toHaveBeenCalled();
  });
});
