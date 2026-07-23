"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Records a single site "visit" per browser session so the admin dashboard can
// count anonymous visitors who land and browse without ever signing up. The
// visitor identity is the httpOnly `swm_vid` cookie (set in middleware) and is
// read server-side — never here. Deduped per tab session via sessionStorage so
// a browsing session counts once, not once per page.
export function TrackVisit() {
  const pathname = usePathname();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    try {
      if (sessionStorage.getItem("swm_visit_tracked")) return;
      sessionStorage.setItem("swm_visit_tracked", "1");
    } catch {
      // sessionStorage blocked (private mode) — fall through and record once.
    }

    fetch("/api/track/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname || "/" }),
      keepalive: true,
    }).catch(() => {});
    // Fire exactly once on first mount for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
