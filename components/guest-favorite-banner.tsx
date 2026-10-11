import { Award, Star } from "lucide-react";

/**
 * Airbnb-style "Guest favourite" banner. Admin-toggled per listing, so it only
 * renders when someone has deliberately marked the home — never inferred from
 * the rating, which would make the badge meaningless.
 */
export function GuestFavoriteBanner({
  average,
  count,
}: {
  average: number;
  count: number;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-brand/30 bg-brand/5 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-start gap-3">
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
          <div className="flex items-center gap-3">
            <div className="text-right leading-none">
              <p className="text-3xl font-bold text-brand">{average}</p>
              <span
                className="mt-1.5 flex items-center justify-end gap-0.5"
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
            {/* Jumps to the listing page's <section id="reviews">, which carries
                scroll-mt-24 to clear the sticky header. Plain anchor so this stays
                a server component and works without JS. */}
            <a
              href="#reviews"
              aria-label={`Jump to ${count} ${count === 1 ? "review" : "reviews"}`}
              className="group rounded-lg leading-none outline-none ring-brand/60 ring-offset-2 ring-offset-background transition-opacity duration-200 ease-ios hover:opacity-80 focus-visible:ring-2"
            >
              <p className="text-3xl font-bold text-brand underline-offset-4 group-hover:underline">
                {count}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground group-hover:text-foreground">
                Reviews
              </p>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
