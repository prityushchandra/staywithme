"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Star, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminListingActions({
  listingId,
  status,
  featured,
}: {
  listingId: string;
  status: string;
  featured: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reason, setReason] = useState("");

  async function act(action: string, extra?: Record<string, unknown>) {
    setLoading(action);
    const res = await fetch(`/api/admin/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setLoading(null);
    setRejecting(false);
    if (res.ok) router.refresh();
  }

  async function destroy() {
    setLoading("delete");
    const res = await fetch(`/api/admin/listings/${listingId}`, { method: "DELETE" });
    setLoading(null);
    setConfirmingDelete(false);
    if (res.ok) router.refresh();
  }

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Reason for rejection"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-52"
        />
        <Button size="sm" variant="destructive" disabled={loading === "reject"} onClick={() => act("reject", { reason })}>
          Confirm reject
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
      </div>
    );
  }

  if (confirmingDelete) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Delete this listing permanently?
        </span>
        <Button size="sm" variant="destructive" disabled={loading === "delete"} onClick={destroy}>
          <Trash2 className="h-4 w-4" /> Confirm delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
      </div>
    );
  }

  const isPublished = status === "PUBLISHED";
  const canApprove = status === "PENDING" || status === "REJECTED" || status === "DRAFT";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canApprove && (
        <Button size="sm" disabled={loading === "approve"} onClick={() => act("approve")}>
          <Check className="h-4 w-4" /> Approve
        </Button>
      )}
      {status !== "REJECTED" && (
        <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
          <X className="h-4 w-4" /> Reject
        </Button>
      )}
      {isPublished && (
        <Button size="sm" variant="outline" disabled={loading === "unpublish"} onClick={() => act("unpublish")}>
          <EyeOff className="h-4 w-4" /> Unpublish
        </Button>
      )}
      {isPublished && (
        <Button
          size="sm"
          variant={featured ? "secondary" : "ghost"}
          disabled={!!loading}
          onClick={() => act(featured ? "unfeature" : "feature")}
        >
          <Star className={featured ? "h-4 w-4 fill-current" : "h-4 w-4"} />
          {featured ? "Featured" : "Feature"}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={() => setConfirmingDelete(true)}
      >
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    </div>
  );
}
