import { describe, it, expect } from "vitest";
import { computeStaffPay, allowedLeaves, deductionPerFlatDay } from "./staff";

// ₹3,000 salary, 4 free holidays, ₹100/day deduction (all in paise).
const SALARY = 300000;
const HOLIDAYS = 4;
const RATE = 10000;

describe("computeStaffPay", () => {
  it("pays the full fixed salary within the free holidays (0..4 absences)", () => {
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 0)).toBe(300000);
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 4)).toBe(300000);
  });

  it("is a fixed monthly amount — never scales up for a 31-day month", () => {
    // The old bug paid ₹100 × days = ₹3,100 for 31 present days; now it's ₹3,000.
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 0)).toBe(300000);
  });

  it("docks ₹100 for each absence beyond the 4 free holidays", () => {
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 5)).toBe(290000); // 1 extra
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 6)).toBe(280000); // 2 extra
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 10)).toBe(240000); // 6 extra
  });

  it("never goes negative", () => {
    expect(computeStaffPay(SALARY, HOLIDAYS, RATE, 40)).toBe(0);
  });

  it("scales the deduction with a different rate/salary", () => {
    // ₹3,600 salary, 4 holidays, ₹120/day → 2 extra absences dock ₹240.
    expect(computeStaffPay(360000, 4, 12000, 6)).toBe(336000);
  });
});

describe("allowedLeaves", () => {
  it("multiplies leaves-per-flat by flats-a-staff-covers (4 × 3 = 12)", () => {
    expect(allowedLeaves(4, 3)).toBe(12);
    expect(allowedLeaves(4, 1)).toBe(4);
    expect(allowedLeaves(2, 5)).toBe(10);
  });

  it("clamps to a non-negative integer", () => {
    expect(allowedLeaves(0, 3)).toBe(0);
    expect(allowedLeaves(-4, 3)).toBe(0);
  });

  it("a staff with 12 allowed leaves is only docked beyond the 12th absence", () => {
    const allowed = allowedLeaves(4, 3); // 12
    expect(computeStaffPay(900000, allowed, 10000, 12)).toBe(900000); // within allowance
    expect(computeStaffPay(900000, allowed, 10000, 15)).toBe(870000); // 3 extra × ₹100
  });
});

describe("deductionPerFlatDay", () => {
  it("derives per-flat-day rate = salary ÷ (flats × 30)", () => {
    expect(deductionPerFlatDay(900000, 3)).toBe(10000); // ₹9,000 / (3×30) = ₹100
    expect(deductionPerFlatDay(600000, 2)).toBe(10000); // ₹6,000 / (2×30) = ₹100
    expect(deductionPerFlatDay(300000, 1)).toBe(10000); // ₹3,000 / 30 = ₹100
  });

  it("treats flats < 1 as 1 and never goes negative", () => {
    expect(deductionPerFlatDay(300000, 0)).toBe(10000);
    expect(deductionPerFlatDay(0, 3)).toBe(0);
  });

  it("rounds to the nearest paise", () => {
    // 1000000 / (3×30) = 11111.11 → 11111
    expect(deductionPerFlatDay(1000000, 3)).toBe(11111);
  });
});
