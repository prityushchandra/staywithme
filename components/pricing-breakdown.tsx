import { computePricing, computeStayBase, isMonthlyRate, formatINR } from "@/lib/pricing";

// Presentational price breakdown. RULE: the label is always "Platform Fee".
export function PricingBreakdown({
  basePrice,
  platformFeePercent,
  nights,
  monthlyPrice,
}: {
  basePrice: number;
  platformFeePercent: number;
  nights?: number;
  monthlyPrice?: number | null;
}) {
  const n = nights && nights > 0 ? nights : 1;
  const monthly = isMonthlyRate(monthlyPrice, n);
  const subtotal = computeStayBase(basePrice, monthlyPrice, n);
  const perNight = Math.round(subtotal / n); // effective nightly (monthly stays)
  const { base, platformFee, total } = computePricing(subtotal, {
    platformFeePercent,
  });
  // What the same stay would cost at the nightly rate — shown struck-through.
  const nightlyTotal = computePricing(basePrice * n, { platformFeePercent }).total;
  const saving = monthly ? nightlyTotal - total : 0;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>
          {formatINR(monthly ? perNight : basePrice)}
          {nights ? ` × ${n} night${n > 1 ? "s" : ""}` : ""}
          {monthly ? " · monthly rate" : ""}
        </span>
        <span>{formatINR(base)}</span>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>
          Platform Fee ({platformFeePercent}%){" "}
          <span className="text-xs">(non-refundable)</span>
        </span>
        <span>{formatINR(platformFee)}</span>
      </div>
      <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
        <span>Total</span>
        <span>
          {saving > 0 ? (
            <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
              {formatINR(nightlyTotal)}
            </span>
          ) : null}
          {formatINR(total)}
        </span>
      </div>
      {saving > 0 ? (
        <p className="text-right text-xs font-medium text-green-700">
          Monthly rate — you save {formatINR(saving)}
        </p>
      ) : null}
    </div>
  );
}
