"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Shared wishlist state. All heart buttons read one query (deduped by key), so
// saving on a card updates every instance instantly.

async function fetchSavedIds(): Promise<string[]> {
  const res = await fetch("/api/wishlist");
  if (!res.ok) return [];
  const data = await res.json();
  return data.ids ?? [];
}

export function useSavedIds() {
  return useQuery({
    queryKey: ["wishlist"],
    queryFn: fetchSavedIds,
    staleTime: 60_000,
  });
}

export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listingId: string) => {
      const res = await fetch("/api/wishlist/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      if (res.status === 401) throw new Error("UNAUTHENTICATED");
      if (!res.ok) throw new Error("TOGGLE_FAILED");
      const data = (await res.json()) as { saved: boolean };
      return { listingId, saved: data.saved };
    },
    // Optimistic update for snappy hearts.
    onMutate: async (listingId) => {
      await qc.cancelQueries({ queryKey: ["wishlist"] });
      const prev = qc.getQueryData<string[]>(["wishlist"]) ?? [];
      const next = prev.includes(listingId)
        ? prev.filter((id) => id !== listingId)
        : [...prev, listingId];
      qc.setQueryData(["wishlist"], next);
      return { prev };
    },
    onError: (_err, _listingId, ctx) => {
      if (ctx?.prev) qc.setQueryData(["wishlist"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
  });
}
