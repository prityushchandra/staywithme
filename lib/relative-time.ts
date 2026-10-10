const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

const unit = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"} ago`;

/**
 * Coarse "2 weeks ago" phrasing for review timestamps.
 *
 * Always resolve this on the server. The listing page is force-dynamic, so a
 * value computed at request time stays stable for the life of the HTML; letting
 * a client component recompute it during hydration would race the clock and
 * produce a mismatch on anything near a unit boundary.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  // A clock skew between the row and the renderer shouldn't read as the future.
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return unit(Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return unit(Math.floor(seconds / HOUR), "hour");

  const days = Math.floor(seconds / DAY);
  if (days < 7) return unit(days, "day");
  if (days < 30) return unit(Math.floor(days / 7), "week");
  if (days < 365) return unit(Math.max(1, Math.floor(days / 30)), "month");
  return unit(Math.max(1, Math.floor(days / 365)), "year");
}
