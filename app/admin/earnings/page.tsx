import { EarningsCharts } from "@/components/admin/earnings-charts";
import { getEarnings } from "@/lib/earnings";
import { formatINR } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Earnings" };

export default async function AdminEarningsPage() {
  const earnings = await getEarnings();
  const kpis = [
    { label: "Total earnings", value: formatINR(earnings.totalPaise), sub: "confirmed revenue" },
    { label: "This month", value: formatINR(earnings.thisMonthPaise), sub: "by check-in date" },
    { label: "This year", value: formatINR(earnings.thisYearPaise), sub: "year-to-date" },
    { label: "Bookings count", value: earnings.bookingsCount.toLocaleString("en-IN"), sub: "confirmed stays" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirmed revenue from direct WhatsApp, offline, and Airbnb bookings.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          At a glance
        </h2>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0 rounded-xl border p-4">
              <div className="truncate text-sm text-muted-foreground">{kpi.label}</div>
              <div className="mt-1 text-2xl font-bold">{kpi.value}</div>
              <div className="text-xs text-muted-foreground">{kpi.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {earnings.totalPaise === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          No earnings yet. Confirmed bookings will appear here with monthly, yearly, and property-wise insights.
        </div>
      )}

      <EarningsCharts data={earnings} />

      <section className="rounded-xl border p-5">
        <h2 className="mb-4 font-semibold">By property</h2>
        {earnings.perProperty.length === 0 ? (
          <p className="text-sm text-muted-foreground">No property earnings to show yet.</p>
        ) : (
          <div className="overflow-x-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Property</th>
                  <th className="py-2 text-right font-medium">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {earnings.perProperty.map((property) => (
                  <tr key={property.propertyId} className="border-b last:border-0">
                    <td className="py-3 font-medium">{property.label}</td>
                    <td className="py-3 text-right">{formatINR(property.paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
