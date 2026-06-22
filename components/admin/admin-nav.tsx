"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  CalendarCheck,
  Star,
  Users,
  Tags,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  exact?: boolean;
  badge?: "listings" | "reviews";
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/admin/listings", label: "Listings", Icon: ListChecks, badge: "listings" },
  { href: "/admin/bookings", label: "Bookings", Icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", Icon: Star, badge: "reviews" },
  { href: "/admin/users", label: "Users", Icon: Users },
  { href: "/admin/catalog", label: "Catalog", Icon: Tags },
  { href: "/admin/settings", label: "Settings", Icon: Settings },
];

export function AdminNav({
  pendingListings,
  pendingReviews,
}: {
  pendingListings: number;
  pendingReviews: number;
}) {
  const pathname = usePathname();

  const count = (key?: NavItem["badge"]) =>
    key === "listings" ? pendingListings : key === "reviews" ? pendingReviews : 0;

  return (
    <nav className="flex flex-wrap gap-1.5 lg:flex-col lg:flex-nowrap lg:gap-1">
      {NAV.map(({ href, label, Icon, exact, badge }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        const n = count(badge);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition duration-200 ease-ios active:scale-[0.97]",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
            {n > 0 && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold lg:ml-auto",
                  active ? "bg-background/20 text-background" : "bg-brand text-white"
                )}
              >
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
