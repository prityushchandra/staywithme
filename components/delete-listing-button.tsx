"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

export function DeleteListingButton({
  listingId,
  title,
}: {
  listingId: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    const res = await fetch(`/api/listings/${listingId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-md">
        <SheetTitle>Delete listing?</SheetTitle>
        <p className="text-sm text-muted-foreground">
          “{title}” will be permanently removed, along with its photos and saved
          entries. This can&apos;t be undone.
        </p>
        <div className="flex gap-3">
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Yes, delete"}
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
