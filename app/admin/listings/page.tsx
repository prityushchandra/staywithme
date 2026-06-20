import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { SmartImage } from "@/components/smart-image";
import { AdminListingActions } from "@/components/admin/listing-actions";
import { ExternalLink, CalendarDays, Lock } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Admin · Listings" };
export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "PENDING", "PUBLISHED", "REJECTED", "DRAFT"] as const;
const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  DRAFT: "secondary",
  PENDING: "warning",
  APPROVED: "default",
  PUBLISHED: "success",
  REJECTED: "destructive",
};

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.includes((status as (typeof STATUSES)[number]) ?? "ALL")
    ? (status as string) ?? "ALL"
    : "ALL";

  const where: Prisma.ListingWhereInput =
    active && active !== "ALL" ? { status: active as Prisma.ListingWhereInput["status"] } : {};

  const listings = await prisma.listing.findMany({
    where,
    include: {
      images: { where: { isCover: true }, take: 1 },
      host: { select: { name: true, email: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Listings</h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const href = s === "ALL" ? "/admin/listings" : `/admin/listings?status=${s}`;
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

      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          No listings in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <div key={l.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative h-24 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40">
                  {l.images[0]?.url && (
                    <SmartImage src={l.images[0].url} alt={l.title} fill sizes="160px" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/listings/${l.id}`} className="break-words font-semibold hover:underline">
                      {l.title}
                    </Link>
                    <Badge variant={STATUS_VARIANT[l.status]}>{l.status}</Badge>
                    {l.featured && <Badge>Featured</Badge>}
                  </div>
                  <p className="break-words text-sm text-muted-foreground">
                    {l.city}, {l.country} · {formatINR(l.basePrice)} base/night · host{" "}
                    {l.host.name ?? l.host.phone ?? l.host.email ?? "—"}
                    {l.host.phone && ` · ${l.host.phone}`}
                  </p>
                  {(l.flatNumber || l.block) && (
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      <Lock className="h-3 w-3" />
                      Confidential ·{" "}
                      {[l.block && `Block ${l.block}`, l.flatNumber && `Flat ${l.flatNumber}`]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {l.status === "REJECTED" && l.rejectionReason && (
                    <p className="mt-1 text-xs text-destructive">Rejected: {l.rejectionReason}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={`/listings/${l.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-foreground"
                    >
                      <ExternalLink className="h-4 w-4" /> Open listing
                    </a>
                    <Link
                      href={`/host/listings/${l.id}/availability`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-foreground"
                    >
                      <CalendarDays className="h-4 w-4" /> Dates
                    </Link>
                    <AdminListingActions listingId={l.id} status={l.status} featured={l.featured} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
