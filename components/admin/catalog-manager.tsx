"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AMENITY_ICON_KEYS } from "@/lib/amenity-icons";

type AmenityRow = { id: string; label: string; icon: string | null };
type BlockRow = { id: string; name: string };

export function CatalogManager({
  amenities,
  blocks,
}: {
  amenities: AmenityRow[];
  blocks: BlockRow[];
}) {
  const router = useRouter();

  // Amenity form
  const [aLabel, setALabel] = useState("");
  const [aIcon, setAIcon] = useState("");
  const [aError, setAError] = useState("");
  const [aBusy, setABusy] = useState(false);

  // Block form
  const [bName, setBName] = useState("");
  const [bError, setBError] = useState("");
  const [bBusy, setBBusy] = useState(false);

  // Inline block rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [deleting, setDeleting] = useState<string | null>(null);

  async function addAmenity(e: React.FormEvent) {
    e.preventDefault();
    setAError("");
    setABusy(true);
    try {
      const res = await fetch("/api/admin/amenities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: aLabel, icon: aIcon || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAError(data.error ?? "Could not add amenity.");
        return;
      }
      setALabel("");
      setAIcon("");
      router.refresh();
    } finally {
      setABusy(false);
    }
  }

  async function addBlock(e: React.FormEvent) {
    e.preventDefault();
    setBError("");
    setBBusy(true);
    try {
      const res = await fetch("/api/admin/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBError(data.error ?? "Could not add block.");
        return;
      }
      setBName("");
      router.refresh();
    } finally {
      setBBusy(false);
    }
  }

  async function remove(kind: "amenities" | "blocks", id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/${kind}?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  function startRename(b: BlockRow) {
    setEditingId(b.id);
    setEditName(b.name);
    setEditError("");
  }

  function cancelRename() {
    setEditingId(null);
    setEditName("");
    setEditError("");
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) {
      setEditError("Enter a block name.");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      const res = await fetch("/api/admin/blocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error ?? "Could not rename block.");
        return;
      }
      cancelRename();
      router.refresh();
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Amenities */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Amenities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addAmenity} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="aLabel">New amenity</Label>
              <Input
                id="aLabel"
                placeholder="e.g. Hot Water"
                value={aLabel}
                onChange={(e) => setALabel(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="aIcon">Icon (optional)</Label>
              <select
                id="aIcon"
                value={aIcon}
                onChange={(e) => setAIcon(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Default (check)</option>
                {AMENITY_ICON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            {aError && <p className="text-sm text-destructive">{aError}</p>}
            <Button type="submit" variant="brand" size="sm" disabled={aBusy}>
              {aBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add amenity
            </Button>
          </form>

          <ul className="divide-y rounded-lg border">
            {amenities.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">No amenities yet.</li>
            )}
            {amenities.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm">
                  {a.label}
                  {a.icon && (
                    <span className="ml-2 text-xs text-muted-foreground">· {a.icon}</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${a.label}`}
                  disabled={deleting === a.id}
                  onClick={() => remove("amenities", a.id)}
                  className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Blocks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Society blocks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addBlock} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="bName">New block / tower</Label>
              <Input
                id="bName"
                placeholder="e.g. Paradise"
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                required
              />
            </div>
            {bError && <p className="text-sm text-destructive">{bError}</p>}
            <Button type="submit" variant="brand" size="sm" disabled={bBusy}>
              {bBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add block
            </Button>
          </form>

          <ul className="divide-y rounded-lg border">
            {blocks.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">No blocks yet.</li>
            )}
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                {editingId === b.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8"
                      autoFocus
                      maxLength={40}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveRename(b.id);
                        }
                        if (e.key === "Escape") cancelRename();
                      }}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Save ${b.name}`}
                        disabled={editBusy}
                        onClick={() => saveRename(b.id)}
                        className="text-muted-foreground transition-colors hover:text-green-600 disabled:opacity-40"
                      >
                        {editBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={cancelRename}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm">{b.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Rename ${b.name}`}
                        onClick={() => startRename(b)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${b.name}`}
                        disabled={deleting === b.id}
                        onClick={() => remove("blocks", b.id)}
                        className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {editError && editingId && (
            <p className="text-sm text-destructive">{editError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
