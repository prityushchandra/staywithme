"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SearchFilters } from "@/components/search-filters";
import { useOverlayHistory } from "@/lib/use-overlay-history";

// Mobile "Filters" button that opens the filters in a slide-over sheet.
export function MobileFilters({
  amenities,
}: {
  amenities: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Back should close the sheet, not throw away the search results behind it.
  const closeAndReplace = useOverlayHistory(open, close);

  function navigate(href: string) {
    if (href === window.location.pathname + window.location.search) {
      close();
      return;
    }
    closeAndReplace(() => router.replace(href));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetTitle>Filters</SheetTitle>
        <SearchFilters amenities={amenities} onNavigate={navigate} />
      </SheetContent>
    </Sheet>
  );
}
