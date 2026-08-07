import { StaffTracker } from "@/components/admin/staff-tracker";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";
import { allowedLeaves, currentMonth, monthLabel } from "@/lib/staff";

export const metadata = { title: "Admin · Staff" };
export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const month = currentMonth();

  const [staff, entries, settings] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.staffMonth.findMany({
      where: { month },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    getPlatformSettings(),
  ]);

  const allowed = allowedLeaves(settings.staffMonthlyHolidays, settings.staffFlatsPerStaff);
  const totalPaid = entries.reduce((sum, r) => sum + r.pay, 0);

  const summaries = staff.map((person) => {
    const entry = entries.find((r) => r.staffId === person.id) ?? null;
    return {
      staffId: person.id,
      staffName: person.name,
      active: person.active,
      salary: person.monthlySalary ?? settings.staffMonthlySalary,
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
          Monthly cleaning pay for {monthLabel(month)}. Each staff member has a fixed salary and{" "}
          {allowed} allowed leaves ({settings.staffMonthlyHolidays} per flat × {settings.staffFlatsPerStaff}{" "}
          flats). Absences beyond that are docked {formatINR(settings.staffDailyRate)}/day.
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
          <p className="text-sm text-muted-foreground">Allowed leaves / month</p>
          <p className="mt-2 text-2xl font-semibold">{allowed}</p>
        </div>
      </div>

      <StaffTracker
        month={month}
        allowed={allowed}
        deductionPerDay={settings.staffDailyRate}
        defaultSalary={settings.staffMonthlySalary}
        leavesPerFlat={settings.staffMonthlyHolidays}
        flatsPerStaff={settings.staffFlatsPerStaff}
        staff={staff.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          active: p.active,
          monthlySalary: p.monthlySalary,
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
