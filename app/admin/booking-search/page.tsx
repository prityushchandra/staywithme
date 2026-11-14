import {
  AdminBookingsPage,
  type AdminBookingSearchParams,
} from "@/components/admin/bookings-page";

export const metadata = { title: "Admin - Booking search" };
export const dynamic = "force-dynamic";

export default function BookingSearchPage({
  searchParams,
}: {
  searchParams: Promise<AdminBookingSearchParams>;
}) {
  return <AdminBookingsPage kind="search" searchParams={searchParams} />;
}
