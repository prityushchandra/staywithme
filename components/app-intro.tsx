"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    StayWithMeIntro?: {
      mount(
        root: HTMLElement,
        options?: { loop?: boolean; onDone?: () => void }
      ): { destroy(): void };
    };
    Capacitor?: unknown;
  }
}

const FADE_MS = 420;

/** Never leave the app stuck behind the overlay if intro.js fails to load. */
const FAILSAFE_MS = 6000;

/**
 * Plays the retro 8-bit intro when the site is launched from the home screen,
 * matching the Android and iOS shells. `INTRO_BOOT` in the root layout decides
 * whether it runs; this component only drives and clears it.
 */
export function AppIntro() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    // CSS keeps the overlay hidden unless the boot script flagged a standalone
    // launch, so there's nothing to drive in a normal browser tab.
    if (!root || document.documentElement.dataset.swmIntro !== "1") return;

    let instance: { destroy(): void } | undefined;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      root.classList.add("swm-intro--hiding");

      window.setTimeout(() => {
        // Dropping the attribute re-hides the overlay and restores scrolling.
        delete document.documentElement.dataset.swmIntro;
        instance?.destroy();
        instance = undefined;
        root.classList.remove("swm-intro--hiding");
        root.replaceChildren();
      }, FADE_MS);
    };

    const failsafe = window.setTimeout(finish, FAILSAFE_MS);

    const script = document.createElement("script");
    script.src = "/intro.js";
    script.async = true;
    script.onload = () => {
      instance = window.StayWithMeIntro?.mount(root, { loop: false, onDone: finish });
      if (!instance) finish();
    };
    script.onerror = finish;
    document.head.appendChild(script);

    return () => {
      window.clearTimeout(failsafe);
      instance?.destroy();
    };
  }, []);

  return <div ref={ref} className="swm-intro-root" aria-hidden="true" />;
}
