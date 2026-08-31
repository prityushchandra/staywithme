"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Pencil, Trash2, X } from "lucide-react";
import { formatINR } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import { ToggleSelect } from "@/components/ui/toggle-select";
import {
  EXPENSE_SOURCES,
  EXPENSE_TYPES,
  EXPENSE_TYPE_LABEL,
  filterExpenses,
  needsSource,
  sumExpenses,
  type ExpenseRow,
  type ExpenseType,
} from "@/lib/expenses";

interface Flat {
  id: string;
  label: string;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function RowActions({
  row,
  onEdit,
  onRemove,
}: {
  row: ExpenseRow;
  onEdit: (r: ExpenseRow) => void;
  onRemove: (r: ExpenseRow) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onEdit(row)}
        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="Edit expense"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onRemove(row)}
        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
        aria-label="Delete expense"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </>
  );
}

export function ExpenseTracker({
  flats,
  expenses,
  today,
}: {
  flats: Flat[];
  expenses: ExpenseRow[];
  today: string;
}) {
  const router = useRouter();

  // --- entry form ---------------------------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listingId, setListingId] = useState(flats[0]?.id ?? "");
  const [type, setType] = useState<ExpenseType>("RENT");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string>(EXPENSE_SOURCES[0]);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // --- viewer filters -----------------------------------------------------
  const [fFlat, setFFlat] = useState("all");
  const [fType, setFType] = useState("all");
  const [fPaidBy, setFPaidBy] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const filters = { listingId: fFlat, type: fType, paidBy: fPaidBy, from: fFrom, to: fTo };
  const rows = useMemo(() => filterExpenses(expenses, filters), [expenses, fFlat, fType, fPaidBy, fFrom, fTo]);
  const total = sumExpenses(rows);

  // Per-type totals for the filtered set, so the split is visible without
  // leaving for the P&L.
  const byType = useMemo(() => {
    const m = new Map<ExpenseType, number>();
    for (const r of rows) m.set(r.type, (m.get(r.type) ?? 0) + r.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const csvHref = (() => {
    const q = new URLSearchParams();
    if (fFlat !== "all") q.set("listingId", fFlat);
    if (fType !== "all") q.set("type", fType);
    if (fPaidBy !== "all") q.set("paidBy", fPaidBy);
    if (fFrom) q.set("from", fFrom);
    if (fTo) q.set("to", fTo);
    const s = q.toString();
    return `/api/admin/expenses/export${s ? `?${s}` : ""}`;
  })();

  const filtersOn = fFlat !== "all" || fType !== "all" || fPaidBy !== "all" || !!fFrom || !!fTo;

  function resetForm() {
    setEditingId(null);
    setAmount("");
    setNote("");
    setDate(today);
    setType("RENT");
  }

  function startEdit(r: ExpenseRow) {
    setEditingId(r.id);
    setListingId(r.listingId);
    setType(r.type);
    setAmount(String(r.amount / 100));
    setPaidBy(r.paidBy ?? EXPENSE_SOURCES[0]);
    setDate(r.date);
    setNote(r.note ?? "");
    setError("");
    setOk("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy(true);
    try {
      const payload = {
        id: editingId,
        listingId,
        type,
        amountRupees: Number(amount),
        date,
        paidBy: needsSource(type) ? paidBy : null,
        note,
      };
      const res = await fetch("/api/admin/expenses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setOk(editingId ? "Updated." : "Recorded.");
      resetForm();
      router.refresh();
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: ExpenseRow) {
    if (!confirm(`Delete ${EXPENSE_TYPE_LABEL[r.type]} of ${formatINR(r.amount)} on ${dayLabel(r.date)}?`))
      return;
    const res = await fetch(`/api/admin/expenses?id=${r.id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === r.id) resetForm();
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Expense tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every running cost of a flat, on the day it belongs to. These feed the Profit &amp; Loss
          statement — rent included, which is why flats no longer carry a rent figure of their own.
          Staff salaries stay in the staff tracker.
        </p>
      </div>

      {/* Record */}
      <section className="rounded-xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{editingId ? "Edit expense" : "Record an expense"}</h2>
          {editingId && (
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Flat</Label>
            <ToggleSelect value={listingId} onValueChange={setListingId} placeholder="Choose flat" ariaLabel="Flat">
              {flats.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </ToggleSelect>
          </div>

          <div className="space-y-1">
            <Label>Type</Label>
            <ToggleSelect
              value={type}
              onValueChange={(v) => setType(v as ExpenseType)}
              placeholder="Type"
              ariaLabel="Expense type"
            >
              {EXPENSE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {EXPENSE_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </ToggleSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ex-amount">Amount (₹)</Label>
            <Input
              id="ex-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ex-date">Date</Label>
            <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {/* Only groceries come out of someone's own pocket, so only they need
              a name against them. */}
          {needsSource(type) && (
            <div className="space-y-1">
              <Label>Paid by</Label>
              <ToggleSelect value={paidBy} onValueChange={setPaidBy} placeholder="Who paid" ariaLabel="Paid by">
                {EXPENSE_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </ToggleSelect>
            </div>
          )}

          <div className={needsSource(type) ? "space-y-1 sm:col-span-2 lg:col-span-2" : "space-y-1 sm:col-span-2 lg:col-span-3"}>
            <Label htmlFor="ex-note">Note (optional)</Label>
            <Input
              id="ex-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. August bill, geyser repair"
            />
          </div>

          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="brand" disabled={busy || flats.length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Record expense"}
            </Button>
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {ok && <p className="mt-2 text-sm text-green-700">{ok}</p>}
      </section>

      {/* View */}
      <section className="rounded-xl border p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Recorded expenses</h2>
          <a
            href={csvHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            <Download className="h-4 w-4" /> CSV
          </a>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label>Flat</Label>
            <ToggleSelect value={fFlat} onValueChange={setFFlat} ariaLabel="Filter by flat">
              <SelectItem value="all">All flats</SelectItem>
              {flats.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </ToggleSelect>
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <ToggleSelect value={fType} onValueChange={setFType} ariaLabel="Filter by type">
              <SelectItem value="all">All types</SelectItem>
              {EXPENSE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {EXPENSE_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </ToggleSelect>
          </div>
          <div className="space-y-1">
            <Label>Paid by</Label>
            <ToggleSelect value={fPaidBy} onValueChange={setFPaidBy} ariaLabel="Filter by who paid">
              <SelectItem value="all">Anyone</SelectItem>
              {EXPENSE_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </ToggleSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </div>
        </div>

        {filtersOn && (
          <button
            type="button"
            onClick={() => {
              setFFlat("all");
              setFType("all");
              setFPaidBy("all");
              setFFrom("");
              setFTo("");
            }}
            className="mb-3 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear filters
          </button>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {expenses.length === 0 ? "No expenses recorded yet." : "No expenses match these filters."}
          </p>
        ) : (
          <>
            {/* Phone: one card per entry. A seven-column table can only be read
                by dragging it sideways, which leaves half of every row cropped. */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{EXPENSE_TYPE_LABEL[r.type]}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {dayLabel(r.date)} · {r.label}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span className="mr-1 font-semibold">{formatINR(r.amount)}</span>
                      <RowActions row={r} onEdit={startEdit} onRemove={remove} />
                    </div>
                  </div>
                  {(r.paidBy || r.note) && (
                    <p className="mt-2 break-words border-t pt-2 text-xs text-muted-foreground">
                      {r.paidBy && <span className="font-medium text-foreground">{r.paidBy}</span>}
                      {r.paidBy && r.note ? " · " : ""}
                      {r.note}
                    </p>
                  )}
                </li>
              ))}
              <li className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 font-semibold">
                <span>
                  Total · {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
                <span>{formatINR(total)}</span>
              </li>
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Flat</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Paid by</th>
                    <th className="py-2 pr-4 font-medium">Note</th>
                    <th className="py-2 pr-4 text-right font-medium">Amount</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4">{dayLabel(r.date)}</td>
                      <td className="whitespace-nowrap py-2 pr-4">{r.label}</td>
                      <td className="whitespace-nowrap py-2 pr-4">{EXPENSE_TYPE_LABEL[r.type]}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{r.paidBy ?? "—"}</td>
                      {/* Notes wrap rather than truncate — a note you can't read
                          is the same as a note you never wrote. */}
                      <td className="w-full min-w-[140px] break-words py-2 pr-4 text-muted-foreground">
                        {r.note ?? "—"}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right font-medium">{formatINR(r.amount)}</td>
                      <td className="whitespace-nowrap py-2 text-right">
                        <RowActions row={r} onEdit={startEdit} onRemove={remove} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td className="py-2 pr-4 font-semibold" colSpan={5}>
                      Total · {rows.length} {rows.length === 1 ? "entry" : "entries"}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right font-bold">{formatINR(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              {byType.map(([t, v]) => (
                <span key={t}>
                  {EXPENSE_TYPE_LABEL[t]} <span className="font-semibold text-foreground">{formatINR(v)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
