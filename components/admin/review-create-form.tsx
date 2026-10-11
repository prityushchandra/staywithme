"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type ListingOption = { id: string; title: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

export function ReviewCreateForm({ listings }: { listings: ListingOption[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState(5);
  const [date, setDate] = useState(todayISO);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, authorName, rating, date, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not post the review");
        return;
      }
      toast("Review posted");
      // The listing page is dynamic, so it re-reads the fresh average on load.
      router.push(`/listings/${listingId}#reviews`);
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
        Publish a listing first, then you can add reviews to it.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4 rounded-xl border p-4 sm:p-5">
      <div className="space-y-1">
        <Label htmlFor="listingId">Listing</Label>
        <select
          id="listingId"
          value={listingId}
          onChange={(e) => setListingId(e.target.value)}
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
        >
          {listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="authorName">Reviewer name</Label>
          <Input
            id="authorName"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="e.g. Ananya S."
            maxLength={60}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="date">Review date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Rating</Label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              aria-pressed={rating === n}
              className="rounded p-0.5 transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  "h-6 w-6",
                  n <= rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground"
                )}
              />
            </button>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">{rating} of 5</span>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="body">Review</Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="What did the guest say about the stay?"
          required
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? "Posting…" : "Post review"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Posted reviews go live immediately and update the listing&apos;s overall rating.
      </p>
    </form>
  );
}
