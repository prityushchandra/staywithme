// Cleaning-staff pay. The base salary is a FIXED monthly amount per flat (e.g.
// ₹3,000), independent of whether the month has 30 or 31 days. Each flat gets a
// number of free holidays (default 4); every absence BEYOND that is docked at
// `deductionPerDay`. All amounts are paise.
//   pay = monthlySalary − max(0, absences − allowedHolidays) × deductionPerDay
export function computeStaffPay(
  monthlySalary: number,
  allowedHolidays: number,
  deductionPerDay: number,
  absences: number
): number {
  const extraAbsences = Math.max(0, absences - allowedHolidays);
  return Math.max(0, monthlySalary - extraAbsences * deductionPerDay);
}

/**
 * Allowed monthly leaves for a staff member = free leaves per flat × the number
 * of flats one staff can cover at a time (e.g. 4 × 3 = 12). Absences beyond this
 * are docked.
 */
export function allowedLeaves(leavesPerFlat: number, flatsPerStaff: number): number {
  return Math.max(0, Math.round(leavesPerFlat) * Math.round(flatsPerStaff));
}

/** Current month as "YYYY-MM" (UTC). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Human label for a "YYYY-MM" month, e.g. "August 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
