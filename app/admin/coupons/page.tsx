import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CouponCreator } from "@/components/admin/coupon-creator";

export const metadata = { title: "Admin - Coupon creator" };
export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect("/");
  const [listings, coupons] = await Promise.all([
    prisma.listing.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, title: true, flatNumber: true, block: true, basePrice: true, minimumNights: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.listingCoupon.findMany({
      include: {
        listing: { select: { title: true, flatNumber: true, block: true } },
        reservation: { select: { bookingId: true, booking: { select: { amountPaid: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const label = (listing: { title: string; flatNumber: string | null; block: string | null }) =>
    [listing.flatNumber, listing.block, listing.title].filter(Boolean).join(" / ");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Coupon creator</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a single-use code for one listing. Set a nightly price or a 30-night price that prorates for longer stays.
        </p>
      </div>
      <CouponCreator
        listings={listings.map((listing) => ({
          id: listing.id, label: label(listing), basePrice: listing.basePrice, minimumNights: listing.minimumNights,
        }))}
        coupons={coupons.map((coupon) => ({
          id: coupon.id, code: coupon.code, kind: coupon.kind, amount: coupon.amount,
          active: coupon.active, listingLabel: label(coupon.listing), createdAt: coupon.createdAt.toISOString(),
          reserved: !!coupon.reservation, paid: (coupon.reservation?.booking?.amountPaid ?? 0) > 0,
          bookingId: coupon.reservation?.bookingId ?? null,
        }))}
      />
    </div>
  );
}
