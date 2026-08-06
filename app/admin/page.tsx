import Link from "next/link";
import {
  Users,
  Home,
  Eye,
  MessageCircle,
  Heart,
  ClipboardCheck,
  Star,
  CheckCircle2,
  Globe,
  Footprints,
  UserPlus,
  IndianRupee,
} from "lucide-react";
import {
  getPlatformOverview,
  getTopListings,
  getTopHosts,
  getTrafficMetrics,
} from "@/lib/admin-analytics";
import { getEarnings } from "@/lib/earnings";
import { formatINR } from "@/lib/pricing";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Admin · Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [overview, topListings, topHosts, traffic, earnings, pendingReviews] = await Promise.all([
    getPlatformOverview(),
    getTopListings(5),
    getTopHosts(5),
    getTrafficMetrics(),
    getEarnings(),
    prisma.review.count({ where: { status: "PENDING" } }),
  ]);

  const pending = overview.listingsByStatus.PENDING ?? 0;
  const published = overview.listingsByStatus.PUBLISHED ?? 0;
  const allCaughtUp = pending === 0 && pendingReviews === 0;

  const kpis = [
    { label: "Users", value: overview.users, sub: `${overview.hosts} hosts`, Icon: Users },
    { label: "Listings", value: overview.totalListings, sub: `${published} live · ${pending} pending`, Icon: Home },
    { label: "Views", value: overview.views, Icon: Eye },
    { label: "Inquiries", value: overview.whatsappClicks, Icon: MessageCircle },
    { label: "Wishlist saves", value: overview.saves, Icon: Heart },
  ];

  const trafficCards = [
    { label: "Unique visitors", value: traffic.uniqueVisitors, sub: "all time", Icon: Globe },
    { label: "Total visits", value: traffic.visits, sub: "browsing sessions", Icon: Footprints },
    { label: "Visitors · 24h", value: traffic.unique24h, sub: "last 24 hours", Icon: Globe },
    { label: "Visitors · 7d", value: traffic.unique7d, sub: "last 7 days", Icon: Globe },
    {
      label: "Signup conversion",
      value: `${traffic.signupConversion}%`,
      sub: `${traffic.registeredUsers} of ${traffic.uniqueVisitors} landed`,
      Icon: UserPlus,
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      {/* Needs attention */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs your attention
        </h2>
        {allCaughtUp ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            All caught up — no pending approvals right now.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {pending > 0 && (
              <Link
                href="/admin/listings?status=PENDING"
                className="flex items-center justify-between rounded-xl border bg-amber-50/60 p-5 transition-colors hover:border-foreground"
              >
                <div>
                  <div className="text-2xl font-bold">{pending}</div>
                  <div className="text-sm text-muted-foreground">
                    listing{pending > 1 ? "s" : ""} awaiting approval
                  </div>
                  <span className="mt-1 inline-block text-sm font-medium text-brand">
                    Review now →
                  </span>
                </div>
                <ClipboardCheck className="h-7 w-7 shrink-0 text-brand" />
              </Link>
            )}
            {pendingReviews > 0 && (
              <Link
                href="/admin/reviews"
                className="flex items-center justify-between rounded-xl border bg-amber-50/60 p-5 transition-colors hover:border-foreground"
              >
                <div>
                  <div className="text-2xl font-bold">{pendingReviews}</div>
                  <div className="text-sm text-muted-foreground">
                    review{pendingReviews > 1 ? "s" : ""} awaiting approval
                  </div>
                  <span className="mt-1 inline-block text-sm font-medium text-brand">
                    Moderate now →
                  </span>
                </div>
                <Star className="h-7 w-7 shrink-0 text-brand" />
              </Link>
            )}
          </div>
        )}
      </section>

      {/* KPIs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          At a glance
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="min-w-0 rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <k.Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{k.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold">{k.value}</div>
              {k.sub && <div className="text-xs text-muted-foreground">{k.sub}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Earnings snapshot */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Earnings
          </h2>
          <Link href="/admin/earnings" className="text-sm font-medium text-brand hover:underline">
            View charts →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total earnings", value: formatINR(earnings.totalPaise), sub: "confirmed revenue" },
            { label: "This month", value: formatINR(earnings.thisMonthPaise), sub: "by check-in" },
            { label: "This year", value: formatINR(earnings.thisYearPaise), sub: "year-to-date" },
            { label: "Confirmed bookings", value: earnings.bookingsCount.toLocaleString("en-IN"), sub: "direct + offline + Airbnb" },
          ].map((k) => (
            <div key={k.label} className="min-w-0 rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IndianRupee className="h-4 w-4 shrink-0" /> <span className="truncate">{k.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold">{k.value}</div>
              <div className="text-xs text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Traffic — includes anonymous visitors who never sign up */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Traffic — visitors who landed
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {trafficCards.map((k) => (
            <div key={k.label} className="min-w-0 rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <k.Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{k.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold">{k.value}</div>
              {k.sub && <div className="text-xs text-muted-foreground">{k.sub}</div>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Counts every browser that lands on the site — not just people who click
          “Get started”. Unique visitors are de-duplicated by an anonymous cookie.
        </p>
      </section>

      {/* Top lists */}
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border p-5">
          <h2 className="mb-3 font-semibold">Top listings</h2>
          {topListings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engagement data yet.</p>
          ) : (
            <div className="overflow-x-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
              <ul className="w-max min-w-full space-y-2">
                {topListings.map((l, i) => (
                  <li key={l.id} className="flex items-center gap-6 whitespace-nowrap text-sm">
                    <Link href={`/listings/${l.id}`} className="hover:underline">
                      <span className="text-muted-foreground">{i + 1}.</span> {l.title}
                    </Link>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {l.views}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {l.whatsappClicks}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-xl border p-5">
          <h2 className="mb-3 font-semibold">Top hosts</h2>
          {topHosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hosts yet.</p>
          ) : (
            <div className="overflow-x-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
              <ul className="w-max min-w-full space-y-2">
                {topHosts.map((h, i) => (
                  <li key={h.hostId} className="flex items-center gap-6 whitespace-nowrap text-sm">
                    <span>
                      <span className="text-muted-foreground">{i + 1}.</span> {h.name ?? h.email ?? "—"}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <Badge variant="secondary">{h.listings} listings</Badge>
                      <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {h.views}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
