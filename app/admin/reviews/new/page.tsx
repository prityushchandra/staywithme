import Link from "next/link";
import { prisma } from "@/lib/db";
import { ReviewCreateForm } from "@/components/admin/review-create-form";

export const metadata = { title: "Admin · Create review" };
export const dynamic = "force-dynamic";

export default async function AdminCreateReviewPage() {
  const listings = await prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Create review</h1>
        <Link href="/admin/reviews" className="text-sm underline-offset-4 hover:underline">
          All reviews
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Post a review on a guest&apos;s behalf. It appears on the listing right away
        and the overall rating recalculates automatically.
      </p>
      <ReviewCreateForm listings={listings} />
    </div>
  );
}
