"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A review as the page hands it over. `timeAgo` is resolved on the server on
 * purpose — recomputing it here during hydration would race the clock and
 * mismatch the rendered HTML for anything sitting on a unit boundary.
 */
export type ReviewListItem = {
  id: string;
  name: string;
  rating: number;
  body: string;
  timeAgo: string;
};

// How many reviews to show before the guest asks for the rest.
const PREVIEW_COUNT = 4;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${
            n <= rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground"
          }`}
        />
      ))}
    </span>
  );
}

export function ReviewList({ reviews }: { reviews: ReviewListItem[] }) {
  const [expanded, setExpanded] = useState(false);

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviews yet — be the first to share your stay.
      </p>
    );
  }

  const collapsible = reviews.length > PREVIEW_COUNT;
  const visible =
    collapsible && !expanded ? reviews.slice(0, PREVIEW_COUNT) : reviews;

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {visible.map((r) => (
          <div key={r.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {r.name.charAt(0).toUpperCase()}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.timeAgo}</p>
              </div>
            </div>
            <Stars rating={r.rating} />
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {r.body}
            </p>
          </div>
        ))}
      </div>
      {collapsible && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-6 w-full sm:w-auto"
        >
          {expanded ? "Show less" : `Show all ${reviews.length} reviews`}
        </Button>
      )}
    </div>
  );
}
