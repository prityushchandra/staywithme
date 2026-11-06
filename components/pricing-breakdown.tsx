import { computePricing, computeStayPricing, isMonthlyRate, formatINR, meetsMinimumStay, minimumStayMessage } from "@/lib/pricing";

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
  const monthly = isMonthlyRate(monthlyPrice, n);
  const { base, platformFee, total, totalBeforeDiscount, monthlyStayDiscount: discount } = computeStayPricing(
    { basePrice, monthlyPrice, minimumNights, monthlyStayDiscount },
    n,
    { platformFeePercent }
  );
  const perNight = Math.round(base / n);
  // What the same stay would cost at the nightly rate — shown struck-through.
  const nightlyTotal = computePricing(basePrice * n, { platformFeePercent }).total;
  const saving = monthly ? nightlyTotal - totalBeforeDiscount : 0;
  // A sale price only changes the bill on nightly stays; a monthly stay is
  // charged off monthlyPrice, so striking the list price there would be a lie.
  const sale = !monthly && listPrice && listPrice > basePrice ? listPrice : null;
  const saleTotal = sale
    ? computePricing(sale * n, { platformFeePercent }).total
    : null;
  // One crossed-out total: the pre-discount price, or the nightly equivalent of
  // a monthly stay. The two never apply at once (a sale is nightly-only).
  const strikeTotal = saleTotal ?? (saving > 0 ? nightlyTotal : discount > 0 ? totalBeforeDiscount : null);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>
          {sale ? (
            <span className="mr-1 line-through">{formatINR(sale)}</span>
          ) : null}
          {formatINR(monthly ? perNight : basePrice)}
          {nights ? ` × ${n} night${n > 1 ? "s" : ""}` : ""}
          {monthly ? " · monthly rate" : ""}
        </span>
        <span>{formatINR(base)}</span>
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
          {strikeTotal ? (
            <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
              {formatINR(strikeTotal)}
            </span>
          ) : null}
          {formatINR(total)}
        </span>
      </div>
      {strikeTotal && strikeTotal > total ? (
        <p className="text-right text-xs font-medium text-green-700">
          You save {formatINR(strikeTotal - total)}
        </p>
      ) : null}
    </div>
  );
}
