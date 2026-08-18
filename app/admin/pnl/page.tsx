import { getPnlData } from "@/lib/pnl";
import { syncStaleCalendars } from "@/lib/calendar-sync";
import { PnlDashboard } from "@/components/admin/pnl-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Profit & Loss" };

export default async function AdminPnlPage() {
  // Available days are counted from imported calendar blocks, so refresh them
  // first: without this the page reported whatever the last listing view or the
  // daily cron happened to leave behind, and dates blocked on Airbnb minutes ago
  // wouldn't show up here even though the in-app calendar already had them.
  await syncStaleCalendars(60_000);
  const pnl = await getPnlData();
  return (
    <PnlDashboard
      rows={pnl.rows}
      months={pnl.months}
      currentMonth={pnl.currentMonth}
    />
  );
}
