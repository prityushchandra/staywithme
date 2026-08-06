import { StaffTracker } from "@/components/admin/staff-tracker";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/pricing";
import { getPlatformSettings } from "@/lib/settings";

export const metadata = { title: "Admin · Staff" };
export const dynamic = "force-dynamic";

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { start, next };
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function AdminStaffPage() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const { start, next } = monthBounds(month);

  const [staff, listings, attendance, settings] = await Promise.all([
    prisma.staff.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true },
      orderBy: { title: "asc" },
    }),
    prisma.staffAttendance.findMany({
      where: { date: { gte: start, lt: next } },
      include: {
        staff: { select: { id: true, name: true, phone: true } },
        listing: { select: { id: true, title: true, flatNumber: true, block: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    getPlatformSettings(),
  ]);

  const summaries = staff.map((person) => {
    const rows = attendance.filter((row) => row.staffId === person.id);
    return {
      staffId: person.id,
      staffName: person.name,
      active: person.active,
      daysWorked: rows.length,
      totalPay: rows.reduce((sum, row) => sum + row.amount, 0),
    };
  });

  const totalPaid = summaries.reduce((sum, row) => sum + row.totalPay, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
        <p className="text-muted-foreground">
          Track flat-wise cleaning attendance and monthly payouts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Paid this month</p>
          <p className="mt-2 text-2xl font-semibold">{formatINR(totalPaid)}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Staff</p>
          <p className="mt-2 text-2xl font-semibold">{staff.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Flat-days cleaned</p>
          <p className="mt-2 text-2xl font-semibold">{attendance.length}</p>
        </div>
      </div>

      <StaffTracker
        month={month}
        today={toDateInput(now)}
        defaultRate={settings.staffDailyRate}
        monthlySalary={settings.staffMonthlySalary}
        monthlyHolidays={settings.staffMonthlyHolidays}
        staff={staff.map((person) => ({
          id: person.id,
          name: person.name,
          phone: person.phone,
          active: person.active,
        }))}
        listings={listings}
        attendance={attendance.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          staffName: row.staff.name,
          listingId: row.listingId,
          listingTitle: row.listing.title,
          flatNumber: row.listing.flatNumber,
          block: row.listing.block,
          date: toDateInput(row.date),
          amount: row.amount,
          note: row.note,
        }))}
        summaries={summaries}
      />
    </div>
  );
}
