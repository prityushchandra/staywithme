"use client";

import { useCallback, useEffect, useRef } from "react";
import { OVERLAY_POP_EVENT } from "./overlay-history-events";

/**
 * Makes a fullscreen overlay (photo viewer, mobile filter sheet, mobile date
 * picker) respond to the device Back gesture by closing itself instead of
 * navigating away.
 *
 * Without this, an overlay is just React state: it covers the whole screen and
 * feels like a page, but the history stack never learned about it. On Android
 * and on an iOS back-swipe the browser pops the *real* previous entry, so a
 * guest who opened a listing from the homepage, tapped a photo, then swiped
 * back lands on the homepage with their scroll position and chosen dates gone.
 *
 * The fix is to push a throwaway history entry when the overlay opens:
 *   - Back gesture  -> `popstate` fires, we close the overlay, the page stays.
 *   - Close button  -> we pop our own entry so Back isn't silently wasted on an
 *                      overlay that is no longer showing.
 *
 * The pushed entry clones the current `history.state`. Next's App Router keeps
 * its routing tree in there, so an entry with a bare state object would look
 * like a foreign history record and make the router hard-navigate on pop.
 * Overlay-only pops are consumed without asking Next to restore a route: that
 * unnecessary restore can discard a pending router update. Real page Back and
 * Forward still receive the routing metadata and follow Next's normal path.
 */
/**
 * Overlays that are currently holding a history entry, oldest first. A date
 * picker opened inside the mobile filter sheet puts two entries on the stack,
 * and only the top one may answer a Back gesture — otherwise one Back closes
 * the whole pile at once.
 */
type HistoryDestination = { parentId: unknown; href: string };
const overlayStack: (HistoryDestination & {
  id: symbol;
  close: () => void;
})[] = [];

/**
 * `history.back()` calls we made ourselves, in the order we made them. Closing
 * an overlay pops its own entry, and that pop is indistinguishable from a real
 * Back gesture at the `popstate` listener — so without this queue the overlay
 * *underneath* hears its neighbour tidying up and closes itself too.
 *
 * Match the destination entry as well as the URL: an unrelated Back must not
 * be swallowed, and a slow traversal must still be recognised when it arrives.
 */
const expectedPops: (HistoryDestination & { finish: () => void })[] = [];
const pendingPops = new Set<Promise<void>>();

// The beforeInteractive bridge forwards this synchronously before Next's
// popstate handler. A real route traversal is never suppressed.
if (typeof window !== "undefined") {
  window.addEventListener(OVERLAY_POP_EVENT, (notification) => {
    const event = (notification as CustomEvent<PopStateEvent>).detail;
    const matches = (entry: HistoryDestination) =>
      entry.parentId === event.state?.overlay &&
      entry.href === window.location.href;
    const i = expectedPops.findIndex(matches);
    if (i >= 0) {
      event.stopImmediatePropagation();
      const [ticket] = expectedPops.splice(i, 1);
      ticket.finish();
      return;
    }

    const top = overlayStack.at(-1);
    if (!top) return;
    if (matches(top)) event.stopImmediatePropagation();
    top.close();
  });
}

export function useOverlayHistory(
  open: boolean,
  onClose: () => void,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const onCloseRef = useRef(onClose);
  const poppedByBrowser = useRef(false);
  const replacedByNavigation = useRef(false);
  const activeEntry = useRef<symbol | null>(null);
  // Cleanups run in declaration order, so this sentinel is set before the
  // effect below tears down. It lets us tell "the overlay closed" apart from
  // "the whole component went away", which matters because calling
  // history.back() during a real navigation would cancel that navigation.
  const unmounting = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => () => {
    unmounting.current = true;
  }, []);

  useEffect(() => {
    if (!open || !enabled) return;

    const history = window.history;
    // On a pop the browser re-applies the scroll offset it recorded for the
    // entry underneath. An overlay locks the page while it's up, so that
    // recorded offset is stale (often 0) and "restoring" it throws the guest
    // back to the top of the page the moment the overlay closes. The overlay
    // puts the scroll position back itself, so take the browser out of it.
    const previousRestoration = history.scrollRestoration;
    const setRestoration = (mode: ScrollRestoration) => {
      try {
        history.scrollRestoration = mode;
      } catch {
        // Not supported here; the browser keeps its default behaviour.
      }
    };
    setRestoration("manual");

    const parentId: unknown = history.state?.overlay;
    const href = window.location.href;
    const overlayId = `${Date.now()}-${Math.random()}`;
    history.pushState({ ...history.state, overlay: overlayId }, "");
    poppedByBrowser.current = false;
    replacedByNavigation.current = false;
    const id = Symbol("overlay");
    activeEntry.current = id;

    const forget = () => {
      const i = overlayStack.findIndex((entry) => entry.id === id);
      if (i >= 0) overlayStack.splice(i, 1);
    };

    const onPop = () => {
      // The browser has already removed our entry by the time this fires, so
      // there is nothing left for us to pop in the cleanup below.
      poppedByBrowser.current = true;
      forget();
      setRestoration(previousRestoration);
      onCloseRef.current();
    };
    overlayStack.push({ id, parentId, href, close: onPop });

    return () => {
      activeEntry.current = null;
      forget();
      if (poppedByBrowser.current || replacedByNavigation.current || unmounting.current) {
        setRestoration(previousRestoration);
        return;
      }

      // `back()` is asynchronous — the pop, and the scroll restoration being
      // suppressed with it, land in a later task. Hand the setting back only
      // once that has happened. Only the scroll setting has a timeout; a route
      // replacement must wait for the actual traversal, however long it takes.
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      pendingPops.add(pending);
      let timer: ReturnType<typeof setTimeout>;
      expectedPops.push({
        parentId,
        href,
        finish: () => {
          clearTimeout(timer);
          setRestoration(previousRestoration);
          pendingPops.delete(pending);
          finish();
        },
      });
      timer = setTimeout(() => setRestoration(previousRestoration), 1000);
      history.back();
    };
  }, [open, enabled]);

  // Replace the overlay's throwaway entry with the destination. Popping it
  // while that navigation is pending would cancel the new route. A nested
  // calendar may still be popping its entry even though it is already hidden.
  return useCallback((replace: () => void) => {
    const entry = activeEntry.current;
    const navigate = () => {
      if (
        unmounting.current ||
        activeEntry.current !== entry ||
        replacedByNavigation.current
      ) return;
      replacedByNavigation.current = true;
      replace();
      onCloseRef.current();
    };
    if (pendingPops.size) {
      void Promise.all([...pendingPops]).then(navigate);
    } else {
      navigate();
    }
  }, []);
}
