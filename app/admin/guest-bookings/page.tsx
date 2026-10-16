import {
  AdminBookingsPage,
  type AdminBookingSearchParams,
} from "@/components/admin/bookings-page";

export const metadata = { title: "Admin - Guest bookings" };
export const dynamic = "force-dynamic";

export default function GuestBookingsPage({
  searchParams,
}: {
  searchParams: Promise<AdminBookingSearchParams>;
}) {
  return <AdminBookingsPage kind="guest" searchParams={searchParams} />;
}
