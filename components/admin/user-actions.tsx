"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff, Home, Ban, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UserActions({
  userId,
  isSelf,
  isAdmin,
  isHost,
  suspended,
}: {
  userId: string;
  isSelf: boolean;
  isAdmin: boolean;
  isHost: boolean;
  suspended: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setLoading(action);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setLoading(null);
    if (res.ok) router.refresh();
  }

  async function del() {
    if (!confirm("Delete this user and all their listings? This can't be undone.")) return;
    setLoading("delete");
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setLoading(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isAdmin ? (
        <Button size="sm" variant="outline" disabled={isSelf || !!loading} onClick={() => act("demote")}>
          <ShieldOff className="h-4 w-4" /> Remove admin
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={!!loading} onClick={() => act("promote")}>
          <ShieldCheck className="h-4 w-4" /> Make admin
        </Button>
      )}
      {!isHost && (
        <Button size="sm" variant="outline" disabled={!!loading} onClick={() => act("grant-host")}>
          <Home className="h-4 w-4" /> Grant host
        </Button>
      )}
      {suspended ? (
        <Button size="sm" variant="outline" disabled={!!loading} onClick={() => act("unsuspend")}>
          <RotateCcw className="h-4 w-4" /> Unsuspend
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={isSelf || !!loading} onClick={() => act("suspend")}>
          <Ban className="h-4 w-4" /> Suspend
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-destructive" disabled={isSelf || !!loading} onClick={del}>
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    </div>
  );
}
