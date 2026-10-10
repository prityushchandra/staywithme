"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Long listing descriptions bury the booking card on a phone, so clamp them and
 * let the guest opt in to the rest. Short ones render untouched — a "Show more"
 * that reveals one extra line is just noise.
 */
export function CollapsibleText({
  text,
  minLength = 240,
  className,
}: {
  text: string;
  minLength?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.trim().length > minLength;

  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-line text-sm leading-relaxed text-muted-foreground",
          collapsible && !expanded && "line-clamp-4",
          className,
        )}
      >
        {text}
      </p>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground underline underline-offset-4 transition hover:opacity-70"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}
