"use client";

import { useState } from "react";
import {
  Wifi,
  Utensils,
  Car,
  Waves,
  Snowflake,
  WashingMachine,
  Tv,
  Laptop,
  Flame,
  PawPrint,
  Fan,
  PlugZap,
  Dumbbell,
  ShowerHead,
  Refrigerator,
  CookingPot,
  Zap,
  Microwave,
  Soup,
  Bath,
  Droplets,
  Shirt,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// How many amenities to show before the guest asks for the rest.
const PREVIEW_COUNT = 4;

// Maps the amenity icon keys stored in the DB to lucide icons. Falls back to a
// check mark for anything unmapped.
const ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  utensils: Utensils,
  car: Car,
  waves: Waves,
  snowflake: Snowflake,
  "washing-machine": WashingMachine,
  tv: Tv,
  laptop: Laptop,
  flame: Flame,
  "paw-print": PawPrint,
  fan: Fan,
  "plug-zap": PlugZap,
  dumbbell: Dumbbell,
  "shower-head": ShowerHead,
  refrigerator: Refrigerator,
  "cooking-pot": CookingPot,
  zap: Zap,
  microwave: Microwave,
  soup: Soup,
  bath: Bath,
  droplets: Droplets,
  shirt: Shirt,
};

export function AmenitiesList({
  amenities,
}: {
  amenities: { id: string; label: string; icon: string | null }[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (amenities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Amenities are confirmed with the platform on WhatsApp.
      </p>
    );
  }

  const collapsible = amenities.length > PREVIEW_COUNT;
  const visible =
    collapsible && !expanded ? amenities.slice(0, PREVIEW_COUNT) : amenities;

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {visible.map((a) => {
          const Icon = (a.icon && ICONS[a.icon]) || Check;
          return (
            <div
              key={a.id}
              className="flex items-center gap-4 border-b py-3.5 text-sm last:border-0 sm:[&:nth-last-child(2)]:border-0"
            >
              <Icon className="h-6 w-6 shrink-0 text-foreground" />
              <span>{a.label}</span>
            </div>
          );
        })}
      </div>
      {collapsible && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-5 w-full sm:w-auto"
        >
          {expanded
            ? "Show less"
            : `Show all ${amenities.length} amenities`}
        </Button>
      )}
    </div>
  );
}
