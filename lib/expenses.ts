// Running costs of keeping a flat let. Rent used to live on the listing itself
// as a single monthlyRent that the P&L back-projected over every month; that
// quietly rewrote history whenever the figure changed. Costs are recorded here
// as dated entries instead, so each month reports what it actually cost.

export const EXPENSE_TYPES = [
  "RENT",
  "ELECTRICITY",
  "GROCERY",
  "GAS",
  "WIFI",
  "REPAIR",
  "OTHER",
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_TYPE_LABEL: Record<ExpenseType, string> = {
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  GROCERY: "Grocery",
  GAS: "Gas",
  WIFI: "Wifi",
  REPAIR: "Repair",
  OTHER: "Other",
};

/**
 * Whether a cost recurs or was a one-off to get the flat going.
 *
 * Only RUNNING costs reach the Profit & Loss. A setup cost — furniture, the
 * deposit, the first fit-out — is capital spent once; charging it to the month
 * it was paid would bury that month in a loss it never really made, and would
 * make every month after it look better than the business actually is.
 */
export const EXPENSE_NATURES = ["RUNNING", "SETUP"] as const;

export type ExpenseNature = (typeof EXPENSE_NATURES)[number];

export const EXPENSE_NATURE_LABEL: Record<ExpenseNature, string> = {
  RUNNING: "Running expense",
  SETUP: "Setup expense",
};

/** Compact label for tables and chips, where the word "expense" is already implied. */
export const EXPENSE_NATURE_SHORT: Record<ExpenseNature, string> = {
  RUNNING: "Running",
  SETUP: "Setup",
};

export const EXPENSE_NATURE_HINT: Record<ExpenseNature, string> = {
  RUNNING: "Recurring cost of keeping the flat let. Counted in the P&L.",
  SETUP: "One-off cost to get the flat going. Tracked, but left out of the P&L.",
};

/** Costs the Profit & Loss is allowed to charge against a month. */
export const PNL_EXPENSE_NATURE: ExpenseNature = "RUNNING";

export function isExpenseNature(v: unknown): v is ExpenseNature {
  return typeof v === "string" && (EXPENSE_NATURES as readonly string[]).includes(v);
}

/** Who can foot a shared cost. Add a name here and it appears everywhere. */
export const EXPENSE_SOURCES = ["Prityush", "Ayushi"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

/**
 * Types where "who paid" is worth recording. Groceries come out of someone's
 * own pocket and have to be settled up later; rent and bills come out of the
 * business, so tagging them with a name would be noise.
 */
const SOURCED_TYPES = new Set<ExpenseType>(["GROCERY"]);

export function needsSource(type: ExpenseType): boolean {
  return SOURCED_TYPES.has(type);
}

export function isExpenseType(v: unknown): v is ExpenseType {
  return typeof v === "string" && (EXPENSE_TYPES as readonly string[]).includes(v);
}

export function isExpenseSource(v: unknown): v is ExpenseSource {
  return typeof v === "string" && (EXPENSE_SOURCES as readonly string[]).includes(v);
}

/** True for a "YYYY-MM-DD" that names a real calendar day. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The "YYYY-MM" a "YYYY-MM-DD" belongs to.
 *
 * Sliced from the string rather than gone via Date, so the month can never
 * shift under a timezone: "2026-08-01" is August wherever it's read.
 */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** UTC midnight of a "YYYY-MM-DD", matching how every other date is keyed. */
export function dateToUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "YYYY-MM-DD" of a stored Date, read back in UTC so it round-trips. */
export function utcToDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Normalise one submitted expense, or say why it can't be saved.
 *
 * A source on a non-grocery cost is dropped rather than rejected: it carries no
 * meaning there, and silently keeping it would let the same cost be filtered
 * two different ways.
 */
export function normalizeExpense(input: {
  listingId?: unknown;
  type?: unknown;
  nature?: unknown;
  amountRupees?: unknown;
  date?: unknown;
  paidBy?: unknown;
  note?: unknown;
}): { ok: true; value: NormalizedExpense } | { ok: false; error: string } {
  const listingId = typeof input.listingId === "string" ? input.listingId.trim() : "";
  if (!listingId) return { ok: false, error: "Pick a flat." };

  if (!isExpenseType(input.type)) return { ok: false, error: "Pick an expense type." };
  const type = input.type;

  // Absent means RUNNING: a caller that predates the split still records a cost
  // the P&L counts, which is what it meant before the split existed.
  if (input.nature != null && !isExpenseNature(input.nature))
    return { ok: false, error: "Pick whether this is a running or setup expense." };
  const nature: ExpenseNature = isExpenseNature(input.nature) ? input.nature : "RUNNING";

  const rupees = Number(input.amountRupees);
  if (!Number.isFinite(rupees) || rupees <= 0) return { ok: false, error: "Enter an amount above zero." };
  if (rupees > 10_000_000) return { ok: false, error: "That amount looks too large." };
  const amount = Math.round(rupees * 100);

  const date = typeof input.date === "string" ? input.date : "";
  if (!isValidDate(date)) return { ok: false, error: "Pick a valid date." };

  let paidBy: string | null = null;
  if (needsSource(type)) {
    if (!isExpenseSource(input.paidBy)) return { ok: false, error: "Choose who paid." };
    paidBy = input.paidBy;
  }

  const noteRaw = typeof input.note === "string" ? input.note.trim() : "";
  const note = noteRaw ? noteRaw.slice(0, 500) : null;

  return {
    ok: true,
    value: { listingId, type, nature, amount, date, month: monthOfDate(date), paidBy, note },
  };
}

export interface NormalizedExpense {
  listingId: string;
  type: ExpenseType;
  nature: ExpenseNature;
  amount: number; // paise
  date: string; // "YYYY-MM-DD"
  month: string; // "YYYY-MM"
  paidBy: string | null;
  note: string | null;
}

export interface ExpenseRow {
  id: string;
  listingId: string;
  label: string;
  type: ExpenseType;
  nature: ExpenseNature;
  amount: number; // paise
  date: string; // "YYYY-MM-DD"
  month: string;
  paidBy: string | null;
  note: string | null;
}

export interface ExpenseFilters {
  listingId?: string;
  type?: string;
  nature?: string;
  paidBy?: string;
  from?: string;
  to?: string;
}

/** Apply the viewer's filters. Shared so the table and the CSV can never differ. */
export function filterExpenses(rows: ExpenseRow[], f: ExpenseFilters): ExpenseRow[] {
  return rows.filter((r) => {
    if (f.listingId && f.listingId !== "all" && r.listingId !== f.listingId) return false;
    if (f.type && f.type !== "all" && r.type !== f.type) return false;
    if (f.nature && f.nature !== "all" && r.nature !== f.nature) return false;
    if (f.paidBy && f.paidBy !== "all" && (r.paidBy ?? "") !== f.paidBy) return false;
    if (f.from && isValidDate(f.from) && r.date < f.from) return false;
    if (f.to && isValidDate(f.to) && r.date > f.to) return false;
    return true;
  });
}

/** Total in paise. */
export function sumExpenses(rows: ExpenseRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Total in paise of just the costs of one nature. */
export function sumExpensesOfNature(rows: ExpenseRow[], nature: ExpenseNature): number {
  return rows.reduce((s, r) => (r.nature === nature ? s + r.amount : s), 0);
}

const CSV_COLUMNS = ["Date", "Flat", "Type", "Nature", "Amount (INR)", "Paid by", "Note"] as const;

/**
 * Escape one CSV cell.
 *
 * The leading-symbol guard stops Excel treating a cell like "=1+1" or "+91…" as
 * a formula — a note or a phone number would otherwise execute or mangle.
 */
function csvCell(value: string): string {
  const v = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function expensesToCsv(rows: ExpenseRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.label,
        EXPENSE_TYPE_LABEL[r.type],
        EXPENSE_NATURE_LABEL[r.nature],
        (r.amount / 100).toFixed(2),
        r.paidBy ?? "",
        r.note ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  lines.push(["", "", "", "Total", (sumExpenses(rows) / 100).toFixed(2), "", ""].map(csvCell).join(","));
  return lines.join("\r\n");
}
