import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Has the guest asked the OS to cut animation? Safe to call during render — it
 * answers `false` on the server, which matches the markup the client hydrates.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Pick a `scrollIntoView`/`scrollTo` behaviour. Never pass `"auto"` when you
 * mean "jump there now" — `"auto"` defers to the CSS `scroll-behavior`, and
 * ours is `smooth`, so the scroll lands frames later. Anything that reads
 * `scrollY` straight after (such as the date picker's body lock) would then
 * capture the old offset and strand the guest at the top of the page.
 */
export function scrollBehavior(animated: boolean): ScrollBehavior {
  return animated && !prefersReducedMotion() ? "smooth" : "instant";
}
