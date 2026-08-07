import { StaffTracker } from "@/components/admin/staff-tracker";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";
import { allowedLeaves, currentMonth, monthLabel } from "@/lib/staff";

export const metadata = { title: "Admin · Staff" };
export const dynamic = "force-dynamic";

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export default async function AdminStaffPage() {
  const month = currentMonth();

  const [staff, listings, entries, settings] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.listing.findMany({ select: { id: true, title: true, flatNumber: true, block: true }, orderBy: { title: "asc" } }),
    prisma.staffMonth.findMany({
      where: { month },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    getPlatformSettings(),
  ]);

  const defaultAllowed = allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const totalPaid = entries.reduce((sum, r) => sum + r.pay, 0);

  const summaries = staff.map((person) => {
    const entry = entries.find((r) => r.staffId === person.id) ?? null;
    return {
      staffId: person.id,
      staffName: person.name,
      active: person.active,
      salary: person.monthlySalary ?? settings.staffMonthlySalary,
      allowed: person.allowedLeaves ?? defaultAllowed,
      absences: entry?.absences ?? 0,
      pay: entry?.pay ?? null,
      hasEntry: !!entry,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
        <p className="text-muted-foreground">
          Cleaning pay for {monthLabel(month)}. Each staff member has a fixed salary, their own
          allowed leaves (in flat-days), and a number of flats. Tap a day to pick which flats they
          missed; absences beyond their allowed leaves are docked from their pay.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Payout this month</p>
          <p className="mt-2 text-2xl font-semibold">{formatINR(totalPaid)}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Active staff</p>
          <p className="mt-2 text-2xl font-semibold">{staff.filter((s) => s.active).length}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Flats</p>
          <p className="mt-2 text-2xl font-semibold">{listings.length}</p>
        </div>
      </div>

      <StaffTracker
        month={month}
        defaultSalary={settings.staffMonthlySalary}
        defaultAllowed={defaultAllowed}
        defaultFlats={settings.staffFlatsPerStaff}
        listings={listings.map((l) => ({ id: l.id, label: flatLabel(l) }))}
        staff={staff.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          active: p.active,
          monthlySalary: p.monthlySalary,
          allowedLeaves: p.allowedLeaves,
          numberOfFlats: p.numberOfFlats,
        }))}
        entries={entries.map((r) => ({
          id: r.id,
          staffId: r.staffId,
          staffName: r.staff.name,
          month: r.month,
          absences: r.absences,
          allowedLeaves: r.allowedLeaves,
          pay: r.pay,
          note: r.note,
        }))}
        summaries={summaries}
      />
    </div>
  );
}
