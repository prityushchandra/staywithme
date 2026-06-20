"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Confirm / Cancel buttons for a booking on the admin bookings page.
export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState("");

  async function act(action: "confirm" | "cancel") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Action failed.");
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "CONFIRMED" && (
        <button
          type="button"
          onClick={() => act("confirm")}
          disabled={busy !== null}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-700 active:scale-[0.97] disabled:opacity-50"
        >
          {busy === "confirm" ? "Confirming…" : "Confirm"}
        </button>
      )}
      {status !== "CANCELLED" && (
        <button
          type="button"
          onClick={() => act("cancel")}
          disabled={busy !== null}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:border-destructive hover:text-destructive active:scale-[0.97] disabled:opacity-50"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
