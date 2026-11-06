import { formatINR, minimumStayMessage, type ListingStayTerms } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function StayTerms({
  minimumNights,
  monthlyStayDiscount,
  compact = false,
}: ListingStayTerms & { compact?: boolean }) {
  if (!minimumNights) return null;
  const hasOffer = monthlyStayDiscount != null && monthlyStayDiscount > 0;

  return (
    <div className={cn(
      "rounded-xl border border-brand/20 bg-brand/5 text-brand-dark",
      compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
    )}>
      {hasOffer ? (
        <>
          <p className="font-semibold">Monthly stays discount</p>
          <p className={cn("mt-1", !compact && "text-base font-medium")}>
            {formatINR(monthlyStayDiscount)} off your total
          </p>
          <p className="mt-1 text-xs">
            {minimumStayMessage(minimumNights)} · Applied once per booking
          </p>
        </>
      ) : (
        <p className="font-medium">{minimumStayMessage(minimumNights)}</p>
      )}
    </div>
  );
}
