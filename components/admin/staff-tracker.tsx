"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/pricing";
import { computeStaffPay, monthLabel } from "@/lib/staff";

type StaffRow = { id: string; name: string; phone: string | null; active: boolean };
type ListingRow = { id: string; title: string; flatNumber: string | null; block: string | null };
type PayrollRow = {
  id: string;
  staffId: string;
  staffName: string;
  listingId: string;
  listingTitle: string;
  flatNumber: string | null;
  block: string | null;
  month: string;
  absences: number;
  allowedHolidays: number;
  pay: number;
  note: string | null;
};
type SummaryRow = { staffId: string; staffName: string; active: boolean; flats: number; totalPay: number };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function flatLabel(l: { title?: string; listingTitle?: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber || l.title || l.listingTitle || "";
  return l.block ? `${base}, ${l.block}` : base;
}

export function StaffTracker({
  month,
  monthlySalary,
  monthlyHolidays,
  deductionPerDay,
  staff,
  listings,
  payroll,
  summaries,
}: {
  month: string;
  monthlySalary: number;
  monthlyHolidays: number;
  deductionPerDay: number;
  staff: StaffRow[];
  listings: ListingRow[];
  payroll: PayrollRow[];
  summaries: SummaryRow[];
}) {
  const router = useRouter();
  const activeStaff = staff.filter((p) => p.active);

  const [staffId, setStaffId] = useState(activeStaff[0]?.id ?? "");
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [entryMonth, setEntryMonth] = useState(month);
  const [absentSet, setAbsentSet] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  const [markError, setMarkError] = useState("");
  const [markBusy, setMarkBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingRow, setDeletingRow] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [staffError, setStaffError] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [updatingStaff, setUpdatingStaff] = useState<string | null>(null);

  // Load the saved absent days whenever the staff / flat / month changes.
  useEffect(() => {
    if (!staffId || !listingId || !/^\d{4}-\d{2}$/.test(entryMonth)) return;
    let cancelled = false;
    setLoadingPrefill(true);
    setSaved(false);
    fetch(`/api/admin/staff-payroll?staffId=${staffId}&listingId=${listingId}&month=${entryMonth}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAbsentSet(new Set<number>(Array.isArray(data.absentDays) ? data.absentDays : []));
        setNote(typeof data.note === "string" ? data.note : "");
      })
      .catch(() => {
        if (!cancelled) setAbsentSet(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoadingPrefill(false);
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, listingId, entryMonth]);

  const [yy, mm] = entryMonth.split("-").map(Number);
  const daysInMonth = yy && mm ? new Date(Date.UTC(yy, mm, 0)).getUTCDate() : 30;
  const firstWeekday = yy && mm ? new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() : 0;

  const absN = absentSet.size;
  const extra = Math.max(0, absN - monthlyHolidays);
  const previewPay = computeStaffPay(monthlySalary, monthlyHolidays, deductionPerDay, absN);

  function toggleDay(day: number) {
    setSaved(false);
    setAbsentSet((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function save() {
    setMarkError("");
    setMarkBusy(true);
    try {
      const res = await fetch("/api/admin/staff-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, listingId, month: entryMonth, absentDays: [...absentSet], note: note.trim() || undefined }),
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
      const res = await fetch(`/api/admin/staff-payroll/${id}`, { method: "DELETE" });
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
        body: JSON.stringify({ name, phone: phone.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStaffError(data.error ?? "Could not add staff.");
        return;
      }
      setName("");
      setPhone("");
      router.refresh();
    } finally {
      setStaffBusy(false);
    }
  }

  async function updateStaff(id: string, active: boolean) {
    setUpdatingStaff(id);
    try {
      const res = await fetch(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (res.ok) router.refresh();
    } finally {
      setUpdatingStaff(null);
    }
  }

  async function deleteStaff(id: string) {
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

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mark attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="staffId">Staff</Label>
                <select id="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                  {activeStaff.length === 0 && <option value="">Add staff first</option>}
                  {activeStaff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="listingId">Flat</Label>
                <select id="listingId" value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                  {listings.map((l) => <option key={l.id} value={l.id}>{flatLabel(l)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="entryMonth">Month</Label>
                <Input id="entryMonth" type="month" value={entryMonth} onChange={(e) => setEntryMonth(e.target.value)} />
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Tap the days this staff was <span className="text-red-600">absent</span></p>
                {loadingPrefill && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const absent = absentSet.has(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      disabled={!staffId || !listingId}
                      className={cn(
                        "aspect-square rounded-md border text-sm transition-colors disabled:opacity-40",
                        absent
                          ? "border-red-500 bg-red-500 font-semibold text-white"
                          : "hover:border-foreground"
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="e.g. Joined mid-month" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">
                {absN} absent · {monthlyHolidays} free{extra > 0 ? ` · ${extra} × ${formatINR(deductionPerDay)} docked` : ""}
              </span>
              <span className="text-lg font-bold">{formatINR(previewPay)}</span>
            </div>

            {markError && <p className="text-sm text-destructive">{markError}</p>}
            {saved && <p className="text-sm text-green-700">Saved.</p>}
            <Button type="button" variant="brand" onClick={save} disabled={markBusy || !staffId || !listingId}>
              {markBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save {monthLabel(entryMonth)}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">This month · {monthLabel(month)}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {payroll.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No entries yet this month.</li>}
              {payroll.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{row.staffName} · {flatLabel(row)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.absences}/{row.allowedHolidays} absent · {formatINR(row.pay)}{row.note ? ` · ${row.note}` : ""}
                    </p>
                  </div>
                  <button type="button" aria-label="Delete entry" disabled={deletingRow === row.id} onClick={() => deleteEntry(row.id)} className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40">
                    {deletingRow === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Monthly payout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatINR(monthlySalary)}/flat · {monthlyHolidays} free holidays · then {formatINR(deductionPerDay)}/extra absent day.
            </p>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Flats</th>
                    <th className="px-3 py-2 font-medium">Pay</th>
                    <th className="px-3 py-2 font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summaries.filter((sm) => sm.flats > 0 || sm.active).map((sm) => (
                    <tr key={sm.staffId}>
                      <td className="px-3 py-2">{sm.staffName}{!sm.active && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}</td>
                      <td className="px-3 py-2">{sm.flats}</td>
                      <td className="px-3 py-2 font-medium">{formatINR(sm.totalPay)}</td>
                      <td className="px-3 py-2">
                        {sm.flats > 0 ? (
                          <Link className="text-primary underline-offset-4 hover:underline" href={`/api/receipts/staff?staffId=${sm.staffId}&month=${month}&download=1`} target="_blank">
                            Payout PDF
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Manage staff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={addStaff} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="staffName">Name</Label>
                  <Input id="staffName" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staffPhone">Phone</Label>
                  <Input id="staffPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              {staffError && <p className="text-sm text-destructive">{staffError}</p>}
              <Button type="submit" variant="brand" size="sm" disabled={staffBusy}>
                {staffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add staff
              </Button>
            </form>

            <ul className="divide-y rounded-lg border">
              {staff.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="text-sm">
                    <p className="font-medium">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.phone || "No phone"} · {person.active ? "Active" : "Inactive"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={updatingStaff === person.id} onClick={() => updateStaff(person.id, !person.active)}>
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
      </div>
    </div>
  );
}
