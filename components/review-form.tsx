"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Review submission form. Signed-in guests only; on success the review is
// queued for moderation (not shown until an admin approves it).
export function ReviewForm({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (rating < 1) {
      setError("Pick a rating");
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/listings/${listingId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, body }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => null);
    setError(data?.error ?? "Something went wrong");
  }

  if (done) {
    return (
      <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        Thanks — your review is pending approval and will appear once a moderator
        reviews it.
      </div>
    );
  }

  const active = hover || rating;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="font-medium">Write a review</p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="p-0.5"
          >
            <Star
              className={`h-6 w-6 ${
                n <= active
                  ? "fill-amber-500 text-amber-500"
                  : "text-muted-foreground"
              }`}
            />
          </button>
        ))}
      </div>
      <Textarea
        placeholder="Tell other guests about your stay…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={2000}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={loading}>
        {loading ? "Submitting…" : "Submit review"}
      </Button>
    </div>
  );
}
