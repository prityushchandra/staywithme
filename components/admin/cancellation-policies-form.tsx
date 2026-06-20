"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Policy = { policy: string; title: string; description: string };

export function CancellationPoliciesForm({ initial }: { initial: Policy[] }) {
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[]>(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function update(i: number, k: "title" | "description", v: string) {
    setPolicies((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/admin/cancellation-policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not save policies.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-lg space-y-5">
      {policies.map((p, i) => (
        <div key={p.policy} className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {p.policy}
          </p>
          <div className="space-y-1">
            <Label htmlFor={`title-${p.policy}`}>Title</Label>
            <Input
              id={`title-${p.policy}`}
              value={p.title}
              onChange={(e) => update(i, "title", e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`desc-${p.policy}`}>Description</Label>
            <Textarea
              id={`desc-${p.policy}`}
              rows={3}
              value={p.description}
              onChange={(e) => update(i, "description", e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-700">Cancellation policies saved.</p>}

      <Button type="submit" variant="brand" disabled={busy}>
        {busy ? "Saving…" : "Save policies"}
      </Button>
    </form>
  );
}
