import { Star } from "lucide-react";
import type { ApprovedReview } from "@/lib/reviews";

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

export function ReviewList({ reviews }: { reviews: ApprovedReview[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviews yet — be the first to share your stay.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {reviews.map((r) => (
        <div key={r.id} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
              {(r.author.name ?? "G").charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <p className="text-sm font-medium">{r.author.name ?? "Guest"}</p>
              <p className="text-xs text-muted-foreground">
                {r.createdAt.toLocaleDateString("en-IN", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <Stars rating={r.rating} />
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {r.body}
          </p>
        </div>
      ))}
    </div>
  );
}
