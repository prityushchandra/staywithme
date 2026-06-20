import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSavedListingIds } from "@/lib/wishlist";

// Returns the current user's saved listing ids (empty array when signed out).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ids: [] });
  const ids = await getSavedListingIds(session.user.id);
  return NextResponse.json({ ids });
}
