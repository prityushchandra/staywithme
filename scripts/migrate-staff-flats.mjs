// Migration: rebuild absence data as day → [listing IDs missed] from the ORIGINAL
// per-flat StaffPayroll rows, and seed each staff's per-staff allowed-leaves.
// Idempotent (overwrites StaffMonth from the backup source of truth).
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
  const defaultAllowed = leavesPerFlat * flatsPerStaff;

  const staff = await prisma.staff.findMany({ include: { payroll: true } });
  let seededAllowed = 0;
  let updated = 0;

  for (const s of staff) {
    // Seed per-staff allowed leaves if unset (default = leaves/flat × flats/staff).
    let allowed = s.allowedLeaves;
    if (allowed == null) {
      allowed = defaultAllowed;
      await prisma.staff.update({ where: { id: s.id }, data: { allowedLeaves: allowed } });
      seededAllowed++;
    }
    const salary = s.monthlySalary ?? defaultSalary;

    // month -> (day -> Set(listingId))
    const byMonth = new Map();
    for (const p of s.payroll) {
      const dayMap = byMonth.get(p.month) ?? new Map();
      for (const d of p.absentDays ?? []) {
        const set = dayMap.get(d) ?? new Set();
        set.add(p.listingId);
        dayMap.set(d, set);
      }
      byMonth.set(p.month, dayMap);
    }

    for (const [month, dayMap] of byMonth) {
      const absentByDay = {};
      let absences = 0;
      for (const [day, set] of dayMap) {
        const ids = [...set];
        absentByDay[String(day)] = ids;
        absences += ids.length;
      }
      const absentDays = Object.keys(absentByDay).map(Number).sort((a, b) => a - b);
      const pay = computePay(salary, allowed, deductionPerDay, absences);
      await prisma.staffMonth.upsert({
        where: { staffId_month: { staffId: s.id, month } },
        update: { absentByDay, absentDays, absences, allowedLeaves: allowed, deductionPerDay, monthlySalary: salary, pay },
        create: { staffId: s.id, month, absentByDay, absentDays, absences, allowedLeaves: allowed, deductionPerDay, monthlySalary: salary, pay },
      });
      updated++;
    }
  }

  console.log(`Done. allowedLeaves seeded: ${seededAllowed}. StaffMonth rows updated: ${updated}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
