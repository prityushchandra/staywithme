"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdminReviewActions({
  reviewId,
  status,
}: {
  reviewId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setLoading(action);
    const res = await fetch(`/api/admin/reviews/${reviewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setLoading(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status !== "APPROVED" && (
        <Button size="sm" disabled={loading === "approve"} onClick={() => act("approve")}>
          <Check className="h-4 w-4" /> Approve
        </Button>
      )}
      {status !== "REJECTED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={loading === "reject"}
          onClick={() => act("reject")}
        >
          <X className="h-4 w-4" /> Reject
        </Button>
      )}
    </div>
  );
}
