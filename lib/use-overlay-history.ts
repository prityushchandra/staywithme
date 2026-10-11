"use client";

import { useEffect, useRef } from "react";

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
 * Cloning keeps the URL and the router tree identical to the entry underneath,
 * which is what makes popping back a no-op for Next and a pure close for us.
 */
export function useOverlayHistory(
  open: boolean,
  onClose: () => void,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const onCloseRef = useRef(onClose);
  const poppedByBrowser = useRef(false);
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

    history.pushState({ ...history.state, overlay: true }, "");
    poppedByBrowser.current = false;

    const onPop = () => {
      // The browser has already removed our entry by the time this fires, so
      // there is nothing left for us to pop in the cleanup below.
      poppedByBrowser.current = true;
      setRestoration(previousRestoration);
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (poppedByBrowser.current || unmounting.current) {
        setRestoration(previousRestoration);
        return;
      }

      // `back()` is asynchronous — the pop, and the scroll restoration being
      // suppressed with it, land in a later task. Hand the setting back only
      // once that has happened, with a timeout in case the pop never comes.
      let timer: ReturnType<typeof setTimeout>;
      const release = () => {
        window.removeEventListener("popstate", release);
        clearTimeout(timer);
        setRestoration(previousRestoration);
      };
      window.addEventListener("popstate", release);
      timer = setTimeout(release, 1000);
      history.back();
    };
  }, [open, enabled]);
}
