import { describe, it, expect } from "vitest";
import { computeStaffPay } from "./staff";

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
