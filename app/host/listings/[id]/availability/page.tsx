import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getBlocks } from "@/lib/availability";
import { syncListingCalendarIfStale } from "@/lib/calendar-sync";
import { AvailabilityEditor } from "@/components/availability-editor";

export const metadata = { title: "Manage availability" };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, hostId: true },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id && !session.user.isAdmin) redirect("/host");

  // Pull the latest Airbnb calendar (if it's been a minute) so a refresh here
  // reflects dates you just blocked/unblocked on Airbnb.
  await syncListingCalendarIfStale(id, 60_000);
  const blocks = await getBlocks(id);

  return (
    <div className="container py-8">
      <Link href="/host" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Availability</h1>
      <p className="mb-6 mt-1 text-muted-foreground">
        {listing.title} — tap dates on the calendar to block or free them up.
      </p>

      <div className="max-w-3xl">
        <AvailabilityEditor
          listingId={listing.id}
          blocks={blocks.map((b) => ({
            id: b.id,
            startDate: b.startDate.toISOString(),
            endDate: b.endDate.toISOString(),
            kind: b.kind,
            guestName: b.guestName,
            guests: b.guests,
            note: b.note,
          }))}
        />
      </div>
    </div>
  );
}
