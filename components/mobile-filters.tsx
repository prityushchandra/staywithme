"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SearchFilters } from "@/components/search-filters";

// Mobile "Filters" button that opens the filters in a slide-over sheet.
export function MobileFilters({
  amenities,
}: {
  amenities: { key: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetTitle>Filters</SheetTitle>
        <SearchFilters amenities={amenities} onApplied={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
