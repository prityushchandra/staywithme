import { StaffTracker } from "@/components/admin/staff-tracker";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";
import { currentMonth, monthLabel } from "@/lib/staff";

export const metadata = { title: "Admin · Staff" };
export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const month = currentMonth();

  const [staff, listings, payroll, settings] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    prisma.staffPayroll.findMany({
      where: { month },
      include: {
        staff: { select: { id: true, name: true } },
        listing: { select: { id: true, title: true, flatNumber: true, block: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getPlatformSettings(),
  ]);

  const totalPaid = payroll.reduce((sum, r) => sum + r.pay, 0);
  const flatsCovered = new Set(payroll.map((r) => r.listingId)).size;

  const summaries = staff.map((person) => {
    const rows = payroll.filter((r) => r.staffId === person.id);
    return {
      staffId: person.id,
      staffName: person.name,
      active: person.active,
      flats: rows.length,
      totalPay: rows.reduce((sum, r) => sum + r.pay, 0),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
        <p className="text-muted-foreground">
          Monthly cleaning pay per flat for {monthLabel(month)}. The salary is a fixed
          amount per flat; absences beyond the free holidays are deducted.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Payroll this month</p>
          <p className="mt-2 text-2xl font-semibold">{formatINR(totalPaid)}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Staff</p>
          <p className="mt-2 text-2xl font-semibold">{staff.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Flats covered</p>
          <p className="mt-2 text-2xl font-semibold">{flatsCovered}</p>
        </div>
      </div>

      <StaffTracker
        month={month}
        monthlySalary={settings.staffMonthlySalary}
        monthlyHolidays={settings.staffMonthlyHolidays}
        deductionPerDay={settings.staffDailyRate}
        staff={staff.map((p) => ({ id: p.id, name: p.name, phone: p.phone, active: p.active }))}
        listings={listings}
        payroll={payroll.map((r) => ({
          id: r.id,
          staffId: r.staffId,
          staffName: r.staff.name,
          listingId: r.listingId,
          listingTitle: r.listing.title,
          flatNumber: r.listing.flatNumber,
          block: r.listing.block,
          month: r.month,
          absences: r.absences,
          allowedHolidays: r.allowedHolidays,
          pay: r.pay,
          note: r.note,
        }))}
        summaries={summaries}
      />
    </div>
  );
}
