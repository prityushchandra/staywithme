import { describe, it, expect } from "vitest";
import {
  needsSource,
  isExpenseType,
  isExpenseSource,
  isValidDate,
  monthOfDate,
  dateToUtc,
  utcToDate,
  normalizeExpense,
  filterExpenses,
  sumExpenses,
  expensesToCsv,
  type ExpenseRow,
} from "./expenses";

function row(p: Partial<ExpenseRow> & { id: string }): ExpenseRow {
  return {
    id: p.id,
    listingId: p.listingId ?? "flat-1",
    label: p.label ?? "G1601",
    type: p.type ?? "RENT",
    amount: p.amount ?? 100_00,
    date: p.date ?? "2026-08-01",
    month: p.month ?? monthOfDate(p.date ?? "2026-08-01"),
    paidBy: p.paidBy ?? null,
    note: p.note ?? null,
  };
}

describe("expense types and sources", () => {
  it("asks who paid only for groceries", () => {
    expect(needsSource("GROCERY")).toBe(true);
    for (const t of ["RENT", "ELECTRICITY", "GAS", "WIFI", "REPAIR", "OTHER"] as const) {
      expect(needsSource(t)).toBe(false);
    }
  });

  it("rejects anything that isn't a known type or source", () => {
    expect(isExpenseType("RENT")).toBe(true);
    expect(isExpenseType("rent")).toBe(false);
    expect(isExpenseType("MORTGAGE")).toBe(false);
    expect(isExpenseType(undefined)).toBe(false);
    expect(isExpenseSource("Prityush")).toBe(true);
    expect(isExpenseSource("Someone")).toBe(false);
  });
});

describe("isValidDate", () => {
  it("accepts real days and rejects impossible ones", () => {
    expect(isValidDate("2026-08-29")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true); // leap year
    expect(isValidDate("2026-02-29")).toBe(false); // not a leap year
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-04-31")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-00-10")).toBe(false);
    expect(isValidDate("2026-08-00")).toBe(false);
    expect(isValidDate("2026-8-9")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

describe("month keying", () => {
  it("reads the month off the string so no timezone can shift it", () => {
    expect(monthOfDate("2026-08-01")).toBe("2026-08");
    expect(monthOfDate("2026-12-31")).toBe("2026-12");
    expect(monthOfDate("2026-01-01")).toBe("2026-01");
  });

  it("round-trips a date through storage", () => {
    for (const d of ["2026-01-01", "2026-08-29", "2026-12-31", "2024-02-29"]) {
      expect(utcToDate(dateToUtc(d))).toBe(d);
    }
  });
});

describe("normalizeExpense", () => {
  const base = { listingId: "flat-1", type: "ELECTRICITY", amountRupees: 1200, date: "2026-08-10" };

  it("converts rupees to paise and derives the month", () => {
    const r = normalizeExpense(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amount).toBe(120_000);
    expect(r.value.month).toBe("2026-08");
    expect(r.value.paidBy).toBeNull();
  });

  it("requires a payer for groceries", () => {
    const missing = normalizeExpense({ ...base, type: "GROCERY" });
    expect(missing.ok).toBe(false);

    const wrong = normalizeExpense({ ...base, type: "GROCERY", paidBy: "Nobody" });
    expect(wrong.ok).toBe(false);

    const good = normalizeExpense({ ...base, type: "GROCERY", paidBy: "Ayushi" });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.paidBy).toBe("Ayushi");
  });

  it("drops a payer on a type that doesn't have one, rather than storing it", () => {
    // Otherwise the same cost could be filtered two different ways.
    const r = normalizeExpense({ ...base, type: "RENT", paidBy: "Prityush" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.paidBy).toBeNull();
  });

  it("refuses a missing flat, bad type, bad date, or an amount out of range", () => {
    expect(normalizeExpense({ ...base, listingId: "  " }).ok).toBe(false);
    expect(normalizeExpense({ ...base, type: "MORTGAGE" }).ok).toBe(false);
    expect(normalizeExpense({ ...base, date: "2026-02-30" }).ok).toBe(false);
    expect(normalizeExpense({ ...base, amountRupees: 0 }).ok).toBe(false);
    expect(normalizeExpense({ ...base, amountRupees: -5 }).ok).toBe(false);
    expect(normalizeExpense({ ...base, amountRupees: "abc" }).ok).toBe(false);
    expect(normalizeExpense({ ...base, amountRupees: 10_000_001 }).ok).toBe(false);
  });

  it("keeps paise from a fractional rupee amount", () => {
    const r = normalizeExpense({ ...base, amountRupees: 99.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.amount).toBe(9_950);
  });

  it("trims a note and treats an empty one as absent", () => {
    const blank = normalizeExpense({ ...base, note: "   " });
    if (blank.ok) expect(blank.value.note).toBeNull();
    const kept = normalizeExpense({ ...base, note: "  paid by card  " });
    if (kept.ok) expect(kept.value.note).toBe("paid by card");
  });
});

describe("filterExpenses", () => {
  const rows = [
    row({ id: "a", listingId: "f1", type: "RENT", date: "2026-07-01", amount: 100 }),
    row({ id: "b", listingId: "f1", type: "GROCERY", date: "2026-08-10", paidBy: "Ayushi", amount: 200 }),
    row({ id: "c", listingId: "f2", type: "WIFI", date: "2026-08-20", amount: 300 }),
    row({ id: "d", listingId: "f2", type: "GROCERY", date: "2026-09-05", paidBy: "Prityush", amount: 400 }),
  ];
  const ids = (rs: ExpenseRow[]) => rs.map((r) => r.id);

  it("returns everything when filters are unset or 'all'", () => {
    expect(ids(filterExpenses(rows, {}))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterExpenses(rows, { listingId: "all", type: "all", paidBy: "all" }))).toEqual(["a", "b", "c", "d"]);
  });

  it("filters by flat, type and payer", () => {
    expect(ids(filterExpenses(rows, { listingId: "f1" }))).toEqual(["a", "b"]);
    expect(ids(filterExpenses(rows, { type: "GROCERY" }))).toEqual(["b", "d"]);
    expect(ids(filterExpenses(rows, { paidBy: "Ayushi" }))).toEqual(["b"]);
  });

  it("treats the date range as inclusive at both ends", () => {
    expect(ids(filterExpenses(rows, { from: "2026-08-10", to: "2026-08-20" }))).toEqual(["b", "c"]);
    expect(ids(filterExpenses(rows, { from: "2026-08-11" }))).toEqual(["c", "d"]);
    expect(ids(filterExpenses(rows, { to: "2026-07-01" }))).toEqual(["a"]);
  });

  it("ignores a half-typed date instead of hiding everything", () => {
    // The date boxes are free text; a partial value must not blank the table.
    expect(ids(filterExpenses(rows, { from: "2026-08" }))).toEqual(["a", "b", "c", "d"]);
  });

  it("combines filters", () => {
    expect(ids(filterExpenses(rows, { listingId: "f2", type: "GROCERY", from: "2026-09-01" }))).toEqual(["d"]);
  });

  it("sums what it kept", () => {
    expect(sumExpenses(filterExpenses(rows, { type: "GROCERY" }))).toBe(600);
    expect(sumExpenses([])).toBe(0);
  });
});

describe("expensesToCsv", () => {
  it("writes a header, the rows in rupees, and a total", () => {
    const csv = expensesToCsv([
      row({ id: "a", amount: 32_000_00, date: "2026-08-01", label: "G1601", type: "RENT" }),
      row({ id: "b", amount: 1_250_50, date: "2026-08-04", label: "L1337", type: "GROCERY", paidBy: "Ayushi" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,Flat,Type,Amount (INR),Paid by,Note");
    expect(lines[1]).toBe("2026-08-01,G1601,Rent,32000.00,,");
    expect(lines[2]).toBe("2026-08-04,L1337,Grocery,1250.50,Ayushi,");
    expect(lines[3]).toBe(",,Total,33250.50,,");
  });

  it("quotes commas, quotes and newlines in a note", () => {
    const csv = expensesToCsv([row({ id: "a", note: 'fixed tap, "urgent"' })]);
    expect(csv.split("\r\n")[1]).toContain('"fixed tap, ""urgent"""');
  });

  it("defuses a note Excel would otherwise run as a formula", () => {
    const csv = expensesToCsv([row({ id: "a", note: "=SUM(A1:A9)" })]);
    expect(csv.split("\r\n")[1]).toContain("'=SUM(A1:A9)");
    const phone = expensesToCsv([row({ id: "b", note: "+919812345678" })]);
    expect(phone.split("\r\n")[1]).toContain("'+919812345678");
  });

  it("still emits a header and a zero total when there is nothing to show", () => {
    const lines = expensesToCsv([]).split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(",,Total,0.00,,");
  });
});
