// Pricing — the single source of truth for "Platform Fee" math and host price insight.
// All money values are integers in MINOR units (paise). 100 paise = ₹1.
//
// RULE: the label is always "Platform Fee" — never "Service Fee".

export interface PricingSettings {
  platformFeePercent: number;
  suggestedPriceMin: number;
  suggestedPriceMax: number;
}

export interface PricingBreakdown {
  /** base price in minor units */
  base: number;
  /** platform fee in minor units, rounded to the nearest whole rupee */
  platformFee: number;
  /** total in minor units = base + platformFee */
  total: number;
  /** the percent applied, echoed for display */
  platformFeePercent: number;
}

/**
 * Compute the guest-facing price breakdown from a host base price.
 * Used identically on listing cards, the property page, the inquiry summary,
 * and the WhatsApp message so the displayed total is always consistent.
 */
export function computePricing(
  basePrice: number,
  settings: Pick<PricingSettings, "platformFeePercent">
): PricingBreakdown {
  const base = Math.max(0, Math.round(basePrice));
  // Round the fee to the nearest whole rupee (100 paise) so the guest-facing
  // total is always a clean rupee figure (e.g. ₹1,209, never ₹1,208.90).
  const platformFee = Math.round((base * settings.platformFeePercent) / 100 / 100) * 100;
  return {
    base,
    platformFee,
    total: base + platformFee,
    platformFeePercent: settings.platformFeePercent,
  };
}

/** Number of nights at/above which a monthly price (if set) kicks in. */
export const MONTHLY_MIN_NIGHTS = 30;

/**
 * Host base total (minor units) for a stay. When the host set a monthly price
 * and the stay is a month or longer (>= MONTHLY_MIN_NIGHTS), the stay is charged
 * at the monthly rate pro-rated per night (monthlyPrice / 30 × nights), which is
 * the discounted long-stay rate. Shorter stays use the nightly base price.
 */
export function computeStayBase(
  basePrice: number,
  monthlyPrice: number | null | undefined,
  nights: number
): number {
  const n = Math.max(1, Math.round(nights));
  if (monthlyPrice && monthlyPrice > 0 && n >= MONTHLY_MIN_NIGHTS) {
    return Math.round((monthlyPrice / 30) * n);
  }
  return basePrice * n;
}

/** True when the monthly rate applies for this stay length + listing. */
export function isMonthlyRate(
  monthlyPrice: number | null | undefined,
  nights: number
): boolean {
  return !!monthlyPrice && monthlyPrice > 0 && Math.round(nights) >= MONTHLY_MIN_NIGHTS;
}

/** Format minor units (paise) as a ₹ string, e.g. 110000 -> "₹1,100". */
export function formatINR(minorUnits: number): string {
  const rupees = Math.round(minorUnits) / 100;
  const formatted = rupees.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₹${formatted}`;
}

export type PriceInsightStatus = "below" | "competitive" | "above";

export interface PriceInsight {
  status: PriceInsightStatus;
  message: string;
  suggestedMin: number;
  suggestedMax: number;
}

/**
 * Host-facing price insight shown live while setting/changing the base price.
 *
 * The recommended range is a STATIC, admin-configured value for now (no market
 * data exists until the ranking/analytics sub-project). This function's shape is
 * intentionally swappable: a later sub-project replaces the static range with a
 * real "comparable listings in this area" computation with no UI changes.
 */
export function getPriceInsight(
  basePrice: number,
  settings: Pick<PricingSettings, "suggestedPriceMin" | "suggestedPriceMax">
): PriceInsight {
  const { suggestedPriceMin: min, suggestedPriceMax: max } = settings;
  const range = `${formatINR(min)}–${formatINR(max)}`;

  if (basePrice < min) {
    return {
      status: "below",
      message: `Similar listings go for ${range} — you may be underpricing.`,
      suggestedMin: min,
      suggestedMax: max,
    };
  }
  if (basePrice > max) {
    return {
      status: "above",
      message: `Most similar stays are ${range} — a lower price may get more inquiries.`,
      suggestedMin: min,
      suggestedMax: max,
    };
  }
  return {
    status: "competitive",
    message: "Your price is competitive for similar stays.",
    suggestedMin: min,
    suggestedMax: max,
  };
}
