"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2, X, Pencil, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/pricing";
import { computeStaffPay, deductionPerFlatDay, monthLabel } from "@/lib/staff";

type StaffRow = { id: string; name: string; phone: string | null; active: boolean; monthlySalary: number | null; allowedLeaves: number | null; numberOfFlats: number | null };
type ListingRow = { id: string; label: string };
type Entry = { id: string; staffId: string; staffName: string; month: string; absences: number; allowedLeaves: number; pay: number; note: string | null };
type SummaryRow = { staffId: string; staffName: string; active: boolean; salary: number; allowed: number; absences: number; pay: number | null; hasEntry: boolean };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function StaffTracker({
  month,
  defaultSalary,
  defaultAllowed,
  defaultFlats,
  listings,
  staff,
  entries,
  summaries,
}: {
  month: string;
  defaultSalary: number;
  defaultAllowed: number;
  defaultFlats: number;
  listings: ListingRow[];
  staff: StaffRow[];
  entries: Entry[];
  summaries: SummaryRow[];
}) {
  const router = useRouter();
  const activeStaff = staff.filter((p) => p.active);

  const [staffId, setStaffId] = useState(activeStaff[0]?.id ?? "");
  const [entryMonth, setEntryMonth] = useState(month);
  // day-of-month → set of listing IDs missed that day.
  const [absent, setAbsent] = useState<Map<number, Set<string>>>(new Map());
  const [note, setNote] = useState("");
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  const [markError, setMarkError] = useState("");
  const [markBusy, setMarkBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingRow, setDeletingRow] = useState<string | null>(null);
  const [modalDay, setModalDay] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [salaryRupees, setSalaryRupees] = useState("");
  const [allowedInput, setAllowedInput] = useState(String(defaultAllowed));
  const [flatsInput, setFlatsInput] = useState(String(defaultFlats));
  const [staffError, setStaffError] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [updatingStaff, setUpdatingStaff] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editSalary, setEditSalary] = useState("");
  const [editAllowed, setEditAllowed] = useState("");
  const [editFlats, setEditFlats] = useState("");

  const selectedStaff = staff.find((p) => p.id === staffId);
  const salary = selectedStaff?.monthlySalary ?? defaultSalary;
  const allowed = selectedStaff?.allowedLeaves ?? defaultAllowed;
  const flats = selectedStaff?.numberOfFlats ?? defaultFlats;
  // Per-flat-day deduction derived from the selected staff's salary.
  const deductionPerDay = deductionPerFlatDay(salary, flats);
  // Live preview of the deduction while adding a staff member.
  const addDeduction = deductionPerFlatDay(Number(salaryRupees || defaultSalary / 100) * 100, Number(flatsInput) || defaultFlats);

  useEffect(() => {
    if (!staffId || !/^\d{4}-\d{2}$/.test(entryMonth)) return;
    let cancelled = false;
    setLoadingPrefill(true);
    setSaved(false);
    fetch(`/api/admin/staff-month?staffId=${staffId}&month=${entryMonth}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const map = new Map<number, Set<string>>();
        const raw = data.absentByDay && typeof data.absentByDay === "object" ? data.absentByDay : {};
        for (const [k, ids] of Object.entries(raw)) {
          const day = Number(k);
          if (day >= 1 && day <= 31 && Array.isArray(ids) && ids.length) map.set(day, new Set(ids as string[]));
        }
        setAbsent(map);
        setNote(typeof data.note === "string" ? data.note : "");
      })
      .catch(() => {
        if (!cancelled) setAbsent(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoadingPrefill(false);
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, entryMonth]);

  const [yy, mm] = entryMonth.split("-").map(Number);
  const daysInMonth = yy && mm ? new Date(Date.UTC(yy, mm, 0)).getUTCDate() : 30;
  const firstWeekday = yy && mm ? new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() : 0;

  const totalFlatDays = [...absent.values()].reduce((s, set) => s + set.size, 0);
  const extra = Math.max(0, totalFlatDays - allowed);
  const previewPay = computeStaffPay(salary, allowed, deductionPerDay, totalFlatDays);

  function toggleFlat(day: number, listingId: string) {
    setSaved(false);
    setAbsent((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(day) ?? []);
      if (set.has(listingId)) set.delete(listingId);
      else set.add(listingId);
      if (set.size === 0) next.delete(day);
      else next.set(day, set);
      return next;
    });
  }

  async function save() {
    setMarkError("");
    setMarkBusy(true);
    try {
      const absentByDay: Record<string, string[]> = {};
      for (const [day, set] of absent) absentByDay[String(day)] = [...set];
      const res = await fetch("/api/admin/staff-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, month: entryMonth, absentByDay, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMarkError(data.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setMarkBusy(false);
    }
  }

  async function deleteEntry(id: string) {
    setDeletingRow(id);
    try {
      const res = await fetch(`/api/admin/staff-month?id=${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingRow(null);
    }
  }

  async function addStaff(event: React.FormEvent) {
    event.preventDefault();
    setStaffError("");
    setStaffBusy(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: phone.trim() || undefined,
          monthlySalaryRupees: salaryRupees ? Number(salaryRupees) : undefined,
          allowedLeaves: allowedInput ? Number(allowedInput) : undefined,
          numberOfFlats: flatsInput ? Number(flatsInput) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStaffError(data.error ?? "Could not add staff.");
        return;
      }
      setName("");
      setPhone("");
      setSalaryRupees("");
      setAllowedInput(String(defaultAllowed));
      setFlatsInput(String(defaultFlats));
      router.refresh();
    } finally {
      setStaffBusy(false);
    }
  }

  async function patchStaff(id: string, body: Record<string, unknown>) {
    setUpdatingStaff(id);
    setStaffError("");
    try {
      const res = await fetch(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStaffError(data.error ?? "Could not update staff.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setUpdatingStaff(null);
    }
  }

  async function saveEdit(id: string) {
    const ok = await patchStaff(id, { monthlySalaryRupees: Number(editSalary) || 0, allowedLeaves: Number(editAllowed) || 0, numberOfFlats: Number(editFlats) || 1 });
    if (ok) setEditId(null);
  }

  async function deleteStaff(id: string) {
    if (!confirm("Remove this staff member? Their attendance history will be deleted too.")) return;
    setUpdatingStaff(id);
    setStaffError("");
    try {
      const res = await fetch(`/api/admin/staff/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStaffError(data.error ?? "Could not remove staff.");
        return;
      }
      router.refresh();
    } finally {
      setUpdatingStaff(null);
    }
  }

  const modalSet = modalDay != null ? absent.get(modalDay) ?? new Set<string>() : new Set<string>();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mark attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="staffId">Staff</Label>
              <select id="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                {activeStaff.length === 0 && <option value="">Add staff first</option>}
                {activeStaff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="entryMonth">Month</Label>
              <Input id="entryMonth" type="month" value={entryMonth} onChange={(e) => setEntryMonth(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Tap a day, then tick the flats she <span className="text-red-600">missed</span> that day.
              </p>
              {loadingPrefill && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="mx-auto w-full max-w-md">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const count = absent.get(day)?.size ?? 0;
                  const intensity = count > 0 && listings.length ? 0.3 + 0.7 * Math.min(1, count / listings.length) : 0;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setModalDay(day)}
                      disabled={!staffId || listings.length === 0}
                      title={count > 0 ? `${count} flat${count > 1 ? "s" : ""} missed` : "Set flats missed"}
                      style={count > 0 ? { backgroundColor: `rgba(220,38,38,${intensity})`, color: "#fff", borderColor: "rgba(220,38,38,0.7)" } : undefined}
                      className={cn(
                        "relative flex aspect-square items-center justify-center rounded-md border text-sm transition-colors disabled:opacity-40",
                        count === 0 && "hover:border-foreground"
                      )}
                    >
                      <span>{day}</span>
                      {count > 0 && (
                        <span className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1 text-[9px] font-bold text-red-600">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">The small number shows how many flats were missed that day.</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="e.g. Joined mid-month" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">
              Salary {formatINR(salary)} · {flats} flat{flats > 1 ? "s" : ""} · {formatINR(deductionPerDay)}/flat-day · {totalFlatDays}/{allowed} absent{extra > 0 ? ` · ${extra} × ${formatINR(deductionPerDay)} docked` : ""}
            </span>
            <span className="text-lg font-bold">{formatINR(previewPay)}</span>
          </div>

          {markError && <p className="text-sm text-destructive">{markError}</p>}
          {saved && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="button" variant="brand" onClick={save} disabled={markBusy || !staffId}>
            {markBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save {monthLabel(entryMonth)}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">This month · {monthLabel(month)}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {entries.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No entries yet this month.</li>}
              {entries.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{row.staffName}</p>
                    <p className="text-xs text-muted-foreground">{row.absences}/{row.allowedLeaves} flat-days · {formatINR(row.pay)}{row.note ? ` · ${row.note}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Link className="text-xs text-primary underline-offset-4 hover:underline" href={`/api/receipts/staff?staffId=${row.staffId}&month=${month}&download=1`} target="_blank">PDF</Link>
                    <button type="button" aria-label="Delete entry" disabled={deletingRow === row.id} onClick={() => deleteEntry(row.id)} className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40">
                      {deletingRow === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Monthly payout · {monthLabel(month)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Fixed salary per staff · their own allowed flat-day leaves · then a per-flat-day dock
            derived from each staff&apos;s salary (salary ÷ flats ÷ 30).
          </p>
          <ul className="space-y-2">
            {summaries.filter((sm) => sm.active || sm.hasEntry).length === 0 && (
              <li className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">Add staff to see payouts here.</li>
            )}
            {summaries.filter((sm) => sm.active || sm.hasEntry).map((sm) => (
              <li key={sm.staffId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {sm.staffName}
                    {!sm.active && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Salary {formatINR(sm.salary)} · {sm.hasEntry ? `${sm.absences}/${sm.allowed} flat-days` : "no entry yet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-base font-semibold">{sm.pay !== null ? formatINR(sm.pay) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">net pay</div>
                  </div>
                  {sm.hasEntry && (
                    <Button asChild size="sm" variant="outline">
                      <a href={`/api/receipts/staff?staffId=${sm.staffId}&month=${month}&download=1`} download>
                        <Download className="h-4 w-4" /> PDF
                      </a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manage staff</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addStaff} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
            <div className="space-y-1">
              <Label htmlFor="staffName">Name</Label>
              <Input id="staffName" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="staffPhone">Phone</Label>
              <Input id="staffPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="staffSalary">Salary (₹/mo)</Label>
              <Input id="staffSalary" type="number" min={0} inputMode="numeric" placeholder={String(Math.round(defaultSalary / 100))} value={salaryRupees} onChange={(e) => setSalaryRupees(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="staffFlats">No. of flats</Label>
              <Input id="staffFlats" type="number" min={1} inputMode="numeric" value={flatsInput} onChange={(e) => setFlatsInput(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="staffAllowed">Allowed leaves</Label>
              <Input id="staffAllowed" type="number" min={0} inputMode="numeric" value={allowedInput} onChange={(e) => setAllowedInput(e.target.value)} />
            </div>
            <Button type="submit" variant="brand" disabled={staffBusy}>
              {staffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add staff
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Deduction rate is computed from salary ÷ flats ÷ 30 ={" "}
            <span className="font-medium text-foreground">{formatINR(addDeduction)}</span> per missed flat-day (beyond allowed leaves).
          </p>
          {staffError && <p className="text-sm text-destructive">{staffError}</p>}

          <ul className="divide-y rounded-lg border">
            {staff.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{person.name}</p>
                  {editId === person.id ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">₹</span>
                      <Input type="number" min={0} value={editSalary} onChange={(e) => setEditSalary(e.target.value)} className="h-8 w-24 text-sm" placeholder="salary" autoFocus />
                      <span className="ml-1 text-xs text-muted-foreground">flats</span>
                      <Input type="number" min={1} value={editFlats} onChange={(e) => setEditFlats(e.target.value)} className="h-8 w-14 text-sm" placeholder="3" />
                      <span className="ml-1 text-xs text-muted-foreground">leaves</span>
                      <Input type="number" min={0} value={editAllowed} onChange={(e) => setEditAllowed(e.target.value)} className="h-8 w-14 text-sm" placeholder="12" />
                      <span className="text-xs text-muted-foreground">
                        → {formatINR(deductionPerFlatDay((Number(editSalary) || 0) * 100, Number(editFlats) || 1))}/flat-day
                      </span>
                      <button type="button" aria-label="Save" onClick={() => saveEdit(person.id)} disabled={updatingStaff === person.id} className="text-green-700 disabled:opacity-40">
                        {updatingStaff === person.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                      <button type="button" aria-label="Cancel" onClick={() => setEditId(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {person.phone || "No phone"} · {person.active ? "Active" : "Inactive"} ·{" "}
                      <button
                        type="button"
                        onClick={() => { setEditId(person.id); setEditSalary(String(Math.round((person.monthlySalary ?? defaultSalary) / 100))); setEditAllowed(String(person.allowedLeaves ?? defaultAllowed)); setEditFlats(String(person.numberOfFlats ?? defaultFlats)); }}
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        {formatINR(person.monthlySalary ?? defaultSalary)} · {person.numberOfFlats ?? defaultFlats} flats · {person.allowedLeaves ?? defaultAllowed} leaves<Pencil className="h-3 w-3" />
                      </button>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={updatingStaff === person.id} onClick={() => patchStaff(person.id, { active: !person.active })}>
                    {person.active ? "Deactivate" : "Activate"}
                  </Button>
                  <button type="button" aria-label={`Remove ${person.name}`} disabled={updatingStaff === person.id} onClick={() => deleteStaff(person.id)} className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40">
                    {updatingStaff === person.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Per-day flat picker modal */}
      {modalDay != null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setModalDay(null)}>
          <div className="w-full max-w-sm rounded-t-2xl border bg-background p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Flats missed · {monthLabel(entryMonth)} {modalDay}</h3>
              <button type="button" aria-label="Close" onClick={() => setModalDay(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Tick each flat she did not clean on this day.</p>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {listings.map((l) => {
                const checked = modalSet.has(l.id);
                return (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50">
                      <input type="checkbox" checked={checked} onChange={() => toggleFlat(modalDay, l.id)} className="h-4 w-4 accent-red-600" />
                      <span className={cn(checked && "font-medium text-red-600")}>{l.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{modalSet.size} of {listings.length} missed</span>
              <Button type="button" size="sm" onClick={() => setModalDay(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
