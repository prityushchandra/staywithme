"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Edit your own name. Saves to the DB, then refreshes the session so the new
// name shows in the navbar and everywhere else immediately.
export function AccountForm({
  initial,
}: {
  initial: { firstName: string; lastName: string; phone: string | null; email: string | null };
}) {
  const router = useRouter();
  const { update } = useSession();

  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty =
    firstName.trim() !== initial.firstName.trim() ||
    lastName.trim() !== initial.lastName.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Could not save your changes.");
        return;
      }

      // Push the new name into the session so the navbar greeting (and anything
      // else reading the session) updates immediately. We pass the values
      // explicitly — a bare update() can be a no-op in this Auth.js version, so
      // it wouldn't re-run the jwt callback that re-reads the name from the DB.
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await update({ firstName: firstName.trim(), lastName: lastName.trim(), name: fullName });
      router.refresh();
      setSaved(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setSaved(false);
            }}
            maxLength={50}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setSaved(false);
            }}
            maxLength={50}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Mobile number</Label>
        <Input value={initial.phone ?? "—"} disabled readOnly />
        <p className="text-xs text-muted-foreground">
          Your number is how you sign in and can&apos;t be changed here.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="brand" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && !dirty && (
          <span className="text-sm font-medium text-green-700">Saved ✓</span>
        )}
      </div>
    </form>
  );
}
