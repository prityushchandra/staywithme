import { formatINR, minimumStayMessage, MONTHLY_MIN_NIGHTS, type ListingStayTerms, type MonthlyStayOffer } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function StayTerms({
  minimumNights,
  monthlyStayDiscount,
  monthlyOffer,
  compact = false,
}: ListingStayTerms & { monthlyOffer?: MonthlyStayOffer | null; compact?: boolean }) {
  if (!minimumNights && !monthlyOffer) return null;
  const hasOffer = !!minimumNights && monthlyStayDiscount != null && monthlyStayDiscount > 0;

  return (
    <div className={cn(
      "rounded-xl border border-brand/20 bg-brand/5 text-brand-dark",
      compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
    )}>
      {monthlyOffer ? (
        <>
          <p className="font-semibold">
            {monthlyOffer.savings > 0 ? "Monthly stays discount" : "Monthly stay rate"}
            {monthlyOffer.savingsPercent > 0 ? ` · ${monthlyOffer.savingsPercent}% off` : ""}
          </p>
          {!compact && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {monthlyOffer.savings > 0 && (
                <span className="text-sm text-muted-foreground line-through">{formatINR(monthlyOffer.regularTotal)}</span>
              )}
              <span className="text-2xl font-semibold tracking-tight">{formatINR(monthlyOffer.total)}</span>
              <span className="text-xs">/ 30 nights</span>
            </p>
          )}
          {monthlyOffer.savings > 0 && (
            <p className="mt-1">Save {formatINR(monthlyOffer.savings)} per 30 nights</p>
          )}
          <p className="mt-1 text-xs">
            {minimumNights ? `${minimumStayMessage(minimumNights)} · ` : ""}
            Prorated for {Math.max(MONTHLY_MIN_NIGHTS, minimumNights ?? 0)}+ nights
          </p>
          {!compact && <p className="mt-1 text-xs text-muted-foreground">Includes Platform Fee. Extra nights use the same daily rate.</p>}
          {hasOffer && <p className="mt-2 text-xs">Additional fixed discount: {formatINR(monthlyStayDiscount)} once from {minimumNights} nights.</p>}
        </>
      ) : hasOffer ? (
        <>
          <p className="font-semibold">Monthly stays discount</p>
          <p className={cn("mt-1", !compact && "text-base font-medium")}>
            {formatINR(monthlyStayDiscount)} off your total
          </p>
          <p className="mt-1 text-xs">
            {minimumStayMessage(minimumNights ?? 1)} · Applied once per booking
          </p>
        </>
      ) : (
        <p className="font-medium">{minimumStayMessage(minimumNights ?? 1)}</p>
      )}
    </div>
  );
}
