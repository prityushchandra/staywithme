import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { razorpayConfigured } from "@/lib/razorpay";
import {
  currentRazorpayMonth, getRazorpayReport, MIN_REPORT_MONTH, razorpayMonthRange,
  type RazorpayBookingReference,
} from "@/lib/razorpay-report";
import { RazorpayPayments, RefreshPayments } from "@/components/admin/razorpay-payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Admin - Razorpay payments" };

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect("/");

  const query = await searchParams;
  const currentMonth = currentRazorpayMonth();
  const month = typeof query.month === "string" ? query.month : currentMonth;
  let error: string | null = null;
  try {
    razorpayMonthRange(month);
  } catch {
    error = "Choose a valid month up to the current month.";
  }
  const selectedMonth = error ? currentMonth : month;

  let content: React.ReactNode = null;
  if (!error && !razorpayConfigured()) {
    error = "Razorpay is not connected. Configure the server payment keys to view payments and settlements.";
  }
  if (!error) {
    try {
      const report = await getRazorpayReport(month);
      const orderIds = [...new Set([
        ...report.payments.map((payment) => payment.order_id),
        ...report.transactions.map((transaction) => transaction.order_id),
      ].filter((id): id is string => id !== null))];
      const bookings = orderIds.length ? await prisma.booking.findMany({
        where: { source: "ONLINE", razorpayOrderId: { in: orderIds } },
        select: {
          id: true, razorpayOrderId: true, status: true,
          guest: { select: { name: true } },
          listing: { select: { title: true, flatNumber: true, block: true } },
        },
      }) : [];
      const references: RazorpayBookingReference[] = bookings.flatMap((booking) => booking.razorpayOrderId ? [{
        id: booking.id, orderId: booking.razorpayOrderId, status: booking.status,
        guestName: booking.guest.name || "Guest",
        listing: [booking.listing.flatNumber || booking.listing.title, booking.listing.block].filter(Boolean).join(", "),
      }] : []);
      content = <RazorpayPayments key={month} report={report} bookings={references}
        testMode={process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ?? false} />;
    } catch (cause) {
      console.error("Razorpay payments dashboard unavailable", cause);
      error = "Could not load a complete Razorpay report. No totals are shown because the data could not be verified. Please refresh to retry or check the Razorpay dashboard.";
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments &amp; bank settlements</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track money received, fees and transfers from your connected Razorpay account.</p>
      </div>
      <RefreshPayments />
    </div>
    <form method="get" action="/admin/payments" className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="payment-month">Report month</Label>
        <Input id="payment-month" name="month" type="month" required min={MIN_REPORT_MONTH} max={currentMonth}
          defaultValue={selectedMonth} className="w-48" />
      </div>
      <Button type="submit" variant="outline">View report</Button>
      <p className="pb-2 text-xs text-muted-foreground">Amounts in INR. All dates in India Standard Time.</p>
    </form>
    {error ? <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm">{error}</div> : content}
  </div>;
}
