import { computeStayPricing, formatINR, meetsMinimumStay, minimumStayMessage } from "@/lib/pricing";

// Presentational price breakdown. RULE: the label is always "Platform Fee".
export function PricingBreakdown({
  basePrice,
  listPrice,
  platformFeePercent,
  nights,
  monthlyPrice,
  minimumNights,
  monthlyStayDiscount,
}: {
  /** The nightly rate actually charged — pass nightlyPrice(listing). */
  basePrice: number;
  /** List price to strike through — pass strikePrice(listing). Null = no sale. */
  listPrice?: number | null;
  platformFeePercent: number;
  nights?: number;
  monthlyPrice?: number | null;
  minimumNights?: number | null;
  monthlyStayDiscount?: number | null;
}) {
  const n = nights && nights > 0 ? nights : 1;
  if (!meetsMinimumStay(n, minimumNights)) {
    return <p className="text-sm text-muted-foreground">{minimumStayMessage(minimumNights ?? 1)}. Choose dates to see your total.</p>;
  }
  const { base, platformFee, total, regularTotal, savings, savingsPercent, monthly, monthlyStayDiscount: discount } = computeStayPricing(
    { basePrice: listPrice ?? basePrice, discountedPrice: basePrice, monthlyPrice, minimumNights, monthlyStayDiscount },
    n,
    { platformFeePercent }
  );
  const sale = !monthly && listPrice && listPrice > basePrice ? listPrice : null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span>
          {sale ? (
            <span className="mr-1 line-through">{formatINR(sale)}</span>
          ) : null}
          {monthly ? `${formatINR(monthlyPrice ?? 0)} ÷ 30` : formatINR(basePrice)}
          {nights ? ` × ${n} night${n > 1 ? "s" : ""}` : ""}
          {monthly ? " · prorated monthly rate" : ""}
        </span>
        <span className="shrink-0">{formatINR(base)}</span>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>Platform Fee ({platformFeePercent}%)</span>
        <span>{formatINR(platformFee)}</span>
      </div>
      {discount > 0 && (
        <div className="flex items-center justify-between gap-3 font-medium text-brand-dark">
          <span>Monthly stays discount</span>
          <span className="shrink-0">−{formatINR(discount)}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
        <span>Total</span>
        <span>
          {savings > 0 ? (
            <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
              {formatINR(regularTotal)}
            </span>
          ) : null}
          {formatINR(total)}
        </span>
      </div>
      {savings > 0 ? (
        <p className="text-right text-xs font-medium text-green-700">
          You save {formatINR(savings)}{savingsPercent > 0 ? ` (${savingsPercent}% off)` : ""}
        </p>
      ) : null}
    </div>
  );
}
