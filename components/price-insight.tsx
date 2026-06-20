"use client";

import { TrendingDown, TrendingUp, CheckCircle2 } from "lucide-react";
import { getPriceInsight } from "@/lib/pricing";
import { cn } from "@/lib/utils";

// Live host pricing insight. Shows the recommended range and where the host's
// price falls. The range comes from PlatformSettings (static now, swappable for
// real comparable-listing data in a later sub-project) — see lib/pricing.ts.
export function PriceInsight({
  basePriceRupees,
  suggestedMinPaise,
  suggestedMaxPaise,
}: {
  basePriceRupees: number;
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
}) {
  if (!basePriceRupees || basePriceRupees <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Enter a nightly base price to see a pricing tip.
      </p>
    );
  }

  const insight = getPriceInsight(basePriceRupees * 100, {
    suggestedPriceMin: suggestedMinPaise,
    suggestedPriceMax: suggestedMaxPaise,
  });

  const styles = {
    competitive: { cls: "text-green-700 bg-green-50", Icon: CheckCircle2 },
    below: { cls: "text-amber-700 bg-amber-50", Icon: TrendingDown },
    above: { cls: "text-blue-700 bg-blue-50", Icon: TrendingUp },
  }[insight.status];

  const { Icon } = styles;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg p-2.5 text-xs",
        styles.cls
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{insight.message}</span>
    </div>
  );
}
