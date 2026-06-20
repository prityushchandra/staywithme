import Link from "next/link";
import {
  Building2,
  Home,
  Castle,
  TreePine,
  Tent,
  Warehouse,
  Hotel,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "", label: "All", Icon: LayoutGrid },
  { key: "APARTMENT", label: "Apartments", Icon: Building2 },
  { key: "HOUSE", label: "Houses", Icon: Home },
  { key: "VILLA", label: "Villas", Icon: Castle },
  { key: "CABIN", label: "Cabins", Icon: TreePine },
  { key: "COTTAGE", label: "Cottages", Icon: Tent },
  { key: "LOFT", label: "Lofts", Icon: Warehouse },
  { key: "GUESTHOUSE", label: "Guesthouses", Icon: Hotel },
];

// Property-type quick filters. `active` is the currently selected propertyType.
export function CategoryChips({ active = "" }: { active?: string }) {
  return (
    <div className="flex gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map(({ key, label, Icon }) => {
        const href = key ? `/search?propertyType=${key}` : "/search";
        const isActive = active === key;
        return (
          <Link
            key={label}
            href={href}
            className={cn(
              "flex shrink-0 flex-col items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
