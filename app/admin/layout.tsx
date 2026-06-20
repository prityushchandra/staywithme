import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { memo } from "@/lib/memo";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Server-side admin guard (don't rely on the middleware JWT claim alone).
  const session = await auth();
  if (!session?.user?.isAdmin) redirect("/");

  // Cache the nav badge counts briefly so every admin navigation doesn't pay two
  // DB round-trips. Admin mutations call clearMemo(), so they refresh on change.
  const [pendingListings, pendingReviews] = await memo(
    "admin-pending-counts",
    15_000,
    () =>
      Promise.all([
        prisma.listing.count({ where: { status: "PENDING" } }),
        prisma.review.count({ where: { status: "PENDING" } }),
      ])
  );

  return (
    <div className="container py-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-20">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin
            </p>
            <AdminNav
              pendingListings={pendingListings}
              pendingReviews={pendingReviews}
            />
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
      </div>
    </div>
  );
}
