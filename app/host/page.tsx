import Link from "next/link";
import { Eye, Plus, Pencil, CalendarDays, ExternalLink } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getListingStats, sumStats } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SmartImage } from "@/components/smart-image";
import { DeleteListingButton } from "@/components/delete-listing-button";

export const metadata = { title: "Host dashboard" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  DRAFT: "secondary",
  PENDING: "warning",
  APPROVED: "default",
  PUBLISHED: "success",
  REJECTED: "destructive",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending review",
  APPROVED: "Approved",
  PUBLISHED: "Live",
  REJECTED: "Rejected",
};

export default async function HostDashboard() {
  const session = await auth();
  const hostId = session!.user.id;

  // Not cached — the dashboard must reflect approvals/edits immediately.
  const listings = await prisma.listing.findMany({
    where: { hostId },
    include: { images: { where: { isCover: true }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });

  const stats = await getListingStats(listings.map((l) => l.id));
  const totals = sumStats(stats);
  const publishedCount = listings.filter((l) => l.status === "PUBLISHED").length;
  const pendingCount = listings.filter((l) => l.status === "PENDING").length;

  const kpis = [
    {
      label: "Listings",
      value: listings.length,
      sub: `${publishedCount} live · ${pendingCount} pending`,
    },
    { label: "Views", value: totals.views, Icon: Eye },
  ];

  return (
    <div className="container py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Host dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {session!.user.name ?? "host"}.</p>
        </div>
        <Button asChild variant="brand">
          <Link href="/host/listings/new">
            <Plus className="h-4 w-4" /> Create listing
          </Link>
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-8 grid grid-cols-2 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {k.Icon && <k.Icon className="h-4 w-4" />} {k.label}
            </div>
            <div className="mt-1 text-2xl font-bold">{k.value}</div>
            {k.sub && <div className="text-xs text-muted-foreground">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Listings */}
      <h2 className="mb-3 text-lg font-semibold">Your listings</h2>
      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          No listings yet. Create your first one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <div key={l.id} className="rounded-xl border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {l.images[0]?.url && (
                    <SmartImage src={l.images[0].url} alt={l.title} fill sizes="112px" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{l.title}</p>
                    <Badge variant={STATUS_VARIANT[l.status]}>
                      {STATUS_LABEL[l.status] ?? l.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {l.city}, {l.country} · {formatINR(l.basePrice)} base/night
                  </p>
                  {l.status === "REJECTED" && l.rejectionReason && (
                    <p className="mt-1 text-xs text-destructive">Rejected: {l.rejectionReason}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {l.status === "PUBLISHED" && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/listings/${l.id}`}><ExternalLink className="h-4 w-4" /> View</Link>
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/host/listings/${l.id}/availability`}><CalendarDays className="h-4 w-4" /> Dates</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/host/listings/${l.id}/edit`}><Pencil className="h-4 w-4" /> Edit</Link>
                  </Button>
                  <DeleteListingButton listingId={l.id} title={l.title} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
