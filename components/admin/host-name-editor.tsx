"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin-only inline editor for a listing's public "Hosted by" display name.
export function AdminHostNameEditor({
  listingId,
  initial,
}: {
  listingId: string;
  initial: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value.trim() !== initial.trim();

  async function save() {
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/admin/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setHostName", hostDisplayName: value }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground">Hosted by</label>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="Host's account name"
        maxLength={50}
        className="h-8 w-44 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="rounded-md border px-2.5 py-1 text-xs font-medium hover:border-foreground disabled:opacity-40"
      >
        {saving ? "Saving…" : saved && !dirty ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
