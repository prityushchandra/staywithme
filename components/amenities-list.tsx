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
  if (amenities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Amenities are confirmed with the platform on WhatsApp.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {amenities.map((a) => {
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
  );
}
