import {
  AdminBookingsPage,
  type AdminBookingSearchParams,
} from "@/components/admin/bookings-page";

export const metadata = { title: "Admin - Bookings" };
export const dynamic = "force-dynamic";

export default function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<AdminBookingSearchParams>;
}) {
  return <AdminBookingsPage kind="offline" searchParams={searchParams} />;
}
