"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart } from "lucide-react";
import { useSavedIds, useToggleWishlist } from "@/lib/use-wishlist";
import { cn } from "@/lib/utils";

// Heart toggle. Signed-out users are sent to sign-in. Used on cards and the
// detail page.
export function WishlistButton({
  listingId,
  className,
  size = "md",
}: {
  listingId: string;
  className?: string;
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const { status } = useSession();
  const { data: savedIds } = useSavedIds();
  const toggle = useToggleWishlist();

  const saved = savedIds?.includes(listingId) ?? false;
  const dim = size === "lg" ? "h-7 w-7" : "h-6 w-6";

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (status !== "authenticated") {
      router.push("/sign-in?callbackUrl=/");
      return;
    }
    toggle.mutate(listingId, {
      // Re-sync server components (e.g. the /wishlists grid) so an unsaved card
      // actually leaves the list, not just un-fills its heart.
      onSuccess: () => router.refresh(),
      onError: (err) => {
        if (err instanceof Error && err.message === "UNAUTHENTICATED") {
          router.push("/sign-in?callbackUrl=/");
        }
      },
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      aria-pressed={saved}
      className={cn(
        "grid place-items-center rounded-full transition-transform active:scale-90",
        className
      )}
    >
      <Heart
        className={cn(
          dim,
          "drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors",
          saved
            ? "fill-brand stroke-brand"
            : "fill-black/30 stroke-white"
        )}
      />
    </button>
  );
}
