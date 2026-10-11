import { Award, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The listing page's single rating surface, sitting directly under the title.
 *
 * `featured` is the admin-toggled "Guest favourite" flag — never inferred from
 * the rating, which would make the badge meaningless. A favourite gets the full
 * Airbnb-style banner; every other listing gets a compact rating pill, so the
 * score is always near the top without two places claiming to own it.
 *
 * Both shapes link to the page's <section id="reviews">, which carries
 * scroll-mt-24 to clear the sticky header. Plain anchors keep this a server
 * component that works without JS.
 */
export function GuestFavoriteBanner({
  featured,
  average,
  count,
}: {
  featured: boolean;
  average: number;
  count: number;
}) {
  const reviewsLabel = `${count} ${count === 1 ? "review" : "reviews"}`;

  if (!featured) {
    if (count === 0) return null;
    return (
      <div className="mb-6">
        <a
          href="#reviews"
          aria-label={`${average} out of 5, jump to ${reviewsLabel}`}
          className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-4 py-2 text-sm transition-colors duration-200 ease-ios hover:bg-muted"
        >
          <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
          <span className="font-semibold">{average}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium underline underline-offset-4">
            {reviewsLabel}
          </span>
        </a>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-brand/30 bg-brand/5 px-5 py-4">
      {/* Stacked on phones — side by side, the badge and the two numbers squeeze
          into an unreadable strip — and a single row from `sm` up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6">
        <div className="flex items-center gap-3 sm:items-start">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
            <Award className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold">Guest favourite</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              One of the most loved homes on StayWithMe
            </p>
          </div>
        </div>

        {count > 0 && (
          <div
            className={cn(
              "flex items-center justify-center gap-5",
              // On phones the numbers become their own full-width row, parted
              // from the badge by a rule instead of trailing off to the left.
              "border-t border-brand/15 pt-3 sm:gap-3 sm:border-0 sm:pt-0"
            )}
          >
            <div className="leading-none">
              <p className="text-center text-3xl font-bold text-brand sm:text-right">
                {average}
              </p>
              <span
                className="mt-1.5 flex items-center justify-center gap-0.5 sm:justify-end"
                aria-label={`${average} out of 5`}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`h-3 w-3 ${
                      n <= Math.round(average)
                        ? "fill-amber-500 text-amber-500"
                        : "text-muted-foreground"
                    }`}
                  />
                ))}
              </span>
            </div>
            <div className="h-10 w-px bg-brand/20" />
            <a
              href="#reviews"
              aria-label={`Jump to ${reviewsLabel}`}
              className="group rounded-lg leading-none outline-none ring-brand/60 ring-offset-2 ring-offset-background transition-opacity duration-200 ease-ios hover:opacity-80 focus-visible:ring-2"
            >
              <p className="text-center text-3xl font-bold text-brand underline-offset-4 group-hover:underline sm:text-left">
                {count}
              </p>
              <p className="mt-1.5 text-center text-xs text-muted-foreground group-hover:text-foreground sm:text-left">
                Reviews
              </p>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
