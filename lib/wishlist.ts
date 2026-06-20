import { prisma } from "./db";

// Single default wishlist per user, created lazily on first save.
export async function getOrCreateDefaultWishlist(userId: string) {
  const existing = await prisma.wishlist.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.wishlist.create({ data: { userId, name: "My Wishlist" } });
}

/** Set of listing ids the user has saved (for hydrating heart buttons). */
export async function getSavedListingIds(userId: string): Promise<string[]> {
  const items = await prisma.wishlistItem.findMany({
    where: { wishlist: { userId } },
    select: { listingId: true },
  });
  return items.map((i) => i.listingId);
}

/** Toggle a listing in the user's default wishlist. Returns the new saved state. */
export async function toggleSaved(
  userId: string,
  listingId: string
): Promise<boolean> {
  const wishlist = await getOrCreateDefaultWishlist(userId);
  const existing = await prisma.wishlistItem.findUnique({
    where: { wishlistId_listingId: { wishlistId: wishlist.id, listingId } },
  });

  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return false;
  }
  await prisma.wishlistItem.create({ data: { wishlistId: wishlist.id, listingId } });
  return true;
}
