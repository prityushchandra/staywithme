// One-off, idempotent migration: fold the old per-(staff, flat, month) StaffPayroll
// rows into the new per-(staff, month) StaffMonth model, WITHOUT touching the
// StaffPayroll table (kept as a backup). For each staff:
//   - seed Staff.monthlySalary (if unset) from the sum of their per-flat salary
//     snapshots in their most recent recorded month (falls back to the platform
//     default), so no pay information is lost;
//   - for each month, union the absent-day marks across all their flats into one
//     StaffMonth calendar and recompute pay with the new allowed-leaves rule.
// Running it again is safe: existing StaffMonth rows are left untouched.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function computePay(salary, allowed, deduction, absences) {
  return Math.max(0, salary - Math.max(0, absences - allowed) * deduction);
}

async function main() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  const leavesPerFlat = settings?.staffMonthlyHolidays ?? 4;
  const flatsPerStaff = settings?.staffFlatsPerStaff ?? 3;
  const deductionPerDay = settings?.staffDailyRate ?? 10000;
  const defaultSalary = settings?.staffMonthlySalary ?? 300000;
  const allowed = leavesPerFlat * flatsPerStaff;

  const staff = await prisma.staff.findMany({ include: { payroll: true } });
  let seeded = 0;
  let created = 0;

  for (const s of staff) {
    // 1) Seed salary from the latest month's per-flat snapshots.
    let salary = s.monthlySalary;
    if (salary == null) {
      salary = defaultSalary;
      if (s.payroll.length) {
        const latestMonth = s.payroll.map((p) => p.month).sort().at(-1);
        const sum = s.payroll
          .filter((p) => p.month === latestMonth)
          .reduce((acc, p) => acc + (p.monthlySalary || 0), 0);
        if (sum > 0) salary = sum;
      }
      await prisma.staff.update({ where: { id: s.id }, data: { monthlySalary: salary } });
      seeded++;
    }

    // 2) Union absent days per month → StaffMonth (don't overwrite existing).
    const byMonth = new Map();
    for (const p of s.payroll) {
      const set = byMonth.get(p.month) ?? new Set();
      for (const d of p.absentDays ?? []) set.add(d);
      const note = byMonth.get(p.month + ":note") ?? p.note ?? null;
      byMonth.set(p.month, set);
      if (note) byMonth.set(p.month + ":note", note);
    }
    for (const [key, val] of byMonth) {
      if (key.endsWith(":note")) continue;
      const month = key;
      const existing = await prisma.staffMonth.findUnique({
        where: { staffId_month: { staffId: s.id, month } },
      });
      if (existing) continue;
      const absentDays = [...val].sort((a, b) => a - b);
      const absences = absentDays.length;
      const pay = computePay(salary, allowed, deductionPerDay, absences);
      await prisma.staffMonth.create({
        data: {
          staffId: s.id,
          month,
          absentDays,
          absences,
          monthlySalary: salary,
          allowedLeaves: allowed,
          deductionPerDay,
          pay,
          note: byMonth.get(month + ":note") ?? null,
        },
      });
      created++;
    }
  }

  console.log(`Migration done. Staff salaries seeded: ${seeded}. StaffMonth rows created: ${created}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
