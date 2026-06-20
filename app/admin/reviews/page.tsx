import Link from "next/link";
import { Star } from "lucide-react";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { AdminReviewActions } from "@/components/admin/review-actions";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Admin · Reviews" };
export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;
const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.includes((status as (typeof STATUSES)[number]) ?? "PENDING")
    ? (status as string) ?? "PENDING"
    : "PENDING";

  const where: Prisma.ReviewWhereInput =
    active && active !== "ALL" ? { status: active } : {};

  const reviews = await prisma.review.findMany({
    where,
    include: {
      author: { select: { name: true, email: true } },
      listing: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const href =
            s === "PENDING" ? "/admin/reviews" : `/admin/reviews?status=${s}`;
          const isActive = active === s;
          return (
            <Link
              key={s}
              href={href}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                isActive ? "border-foreground bg-foreground text-background" : "hover:border-foreground"
              }`}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </Link>
          );
        })}
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          No reviews in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/listings/${r.listing.id}`} className="break-words font-semibold hover:underline">
                  {r.listing.title}
                </Link>
                <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                <span className="flex items-center gap-0.5 text-sm">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-3.5 w-3.5 ${
                        n <= r.rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground"
                      }`}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                by {r.author.name ?? r.author.email} ·{" "}
                {r.createdAt.toLocaleDateString("en-IN")}
              </p>
              <p className="mt-2 whitespace-pre-line break-words text-sm">{r.body}</p>
              <div className="mt-3">
                <AdminReviewActions reviewId={r.id} status={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
