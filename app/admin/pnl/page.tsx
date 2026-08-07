import { getPnlData } from "@/lib/pnl";
import { PnlDashboard } from "@/components/admin/pnl-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Profit & Loss" };

export default async function AdminPnlPage() {
  const pnl = await getPnlData();
  return (
    <PnlDashboard
      rows={pnl.rows}
      months={pnl.months}
      currentMonth={pnl.currentMonth}
    />
  );
}
