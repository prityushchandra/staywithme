"use client";

import { useEffect, useRef } from "react";

// Fires a single VIEW event for a listing on mount. Best-effort; failures are
// ignored. (Anti-gaming / dedup lives in the analytics engine, Sub-project #6.)
export function TrackView({ listingId }: { listingId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "VIEW", listingId }),
      keepalive: true,
    }).catch(() => {});
  }, [listingId]);
  return null;
}
