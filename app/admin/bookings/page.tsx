import { redirect } from "next/navigation";
import {
  AdminBookingsPage,
  type AdminBookingSearchParams,
} from "@/components/admin/bookings-page";

export const metadata = { title: "Admin - Bookings" };
export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<AdminBookingSearchParams>;
}) {
  const params = await searchParams;
  if (params.view === "past") {
    const query = new URLSearchParams({ view: "past" });
    for (const key of ["flat", "from", "to", "status", "source", "guest"] as const) {
      if (params[key]) query.set(key, params[key]);
    }
    redirect(`/admin/booking-search?${query}`);
  }
  return <AdminBookingsPage kind="offline" searchParams={Promise.resolve(params)} />;
}
