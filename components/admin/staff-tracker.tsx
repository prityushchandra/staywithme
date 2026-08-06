"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/pricing";

type StaffRow = { id: string; name: string; phone: string | null; active: boolean };
type ListingRow = { id: string; title: string; flatNumber: string | null; block: string | null };
type AttendanceRow = {
  id: string;
  staffId: string;
  staffName: string;
  listingId: string;
  listingTitle: string;
  flatNumber: string | null;
  block: string | null;
  date: string;
  amount: number;
  note: string | null;
};
type SummaryRow = {
  staffId: string;
  staffName: string;
  active: boolean;
  daysWorked: number;
  totalPay: number;
};

function flatLabel(listing: { title?: string; listingTitle?: string; flatNumber: string | null; block: string | null }) {
  return [listing.flatNumber || listing.title || listing.listingTitle, listing.block]
    .filter(Boolean)
    .join(", ");
}

export function StaffTracker({
  month,
  today,
  defaultRate,
  monthlySalary,
  monthlyHolidays,
  staff,
  listings,
  attendance,
  summaries,
}: {
  month: string;
  today: string;
  defaultRate: number;
  monthlySalary: number;
  monthlyHolidays: number;
  staff: StaffRow[];
  listings: ListingRow[];
  attendance: AttendanceRow[];
  summaries: SummaryRow[];
}) {
  const router = useRouter();
  const activeStaff = staff.filter((person) => person.active);
  const [staffId, setStaffId] = useState(activeStaff[0]?.id ?? "");
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [markError, setMarkError] = useState("");
  const [markBusy, setMarkBusy] = useState(false);
  const [deletingAttendance, setDeletingAttendance] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [staffError, setStaffError] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [updatingStaff, setUpdatingStaff] = useState<string | null>(null);

  async function markPresent(event: React.FormEvent) {
    event.preventDefault();
    setMarkError("");
    setMarkBusy(true);
    try {
      const res = await fetch("/api/admin/staff-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          listingId,
          date,
          amount: amount ? Number(amount) : undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMarkError(data.error ?? "Could not mark attendance.");
        return;
      }
      setNote("");
      router.refresh();
    } finally {
      setMarkBusy(false);
    }
  }

  async function deleteAttendance(id: string) {
    setDeletingAttendance(id);
    try {
      const res = await fetch(`/api/admin/staff-attendance/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingAttendance(null);
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
            <CardTitle className="text-lg">Mark cleaning</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={markPresent} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="staffId">Staff</Label>
                <select
                  id="staffId"
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  required
                >
                  {activeStaff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="listingId">Flat</Label>
                <select
                  id="listingId"
                  value={listingId}
                  onChange={(event) => setListingId(event.target.value)}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  required
                >
                  {listings.map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {flatLabel(listing)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder={String(defaultRate / 100)}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Input id="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Deep cleaning" />
              </div>
              {markError && <p className="text-sm text-destructive md:col-span-2">{markError}</p>}
              <div className="md:col-span-2">
                <Button type="submit" variant="brand" disabled={markBusy || !staffId || !listingId}>
                  {markBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Mark present
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Today / this month</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {attendance.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No cleaning marked this month.</li>}
              {attendance.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{row.staffName} · {flatLabel(row)}</p>
                    <p className="text-xs text-muted-foreground">{row.date} · {formatINR(row.amount)}{row.note ? ` · ${row.note}` : ""}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete attendance"
                    disabled={deletingAttendance === row.id}
                    onClick={() => deleteAttendance(row.id)}
                    className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40"
                  >
                    {deletingAttendance === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
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
            <CardTitle className="text-lg">Monthly pay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reference salary {formatINR(monthlySalary)}, {monthlyHolidays} holidays/flat, rate {formatINR(defaultRate)}/flat/day.
            </p>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Days</th>
                    <th className="px-3 py-2 font-medium">Pay</th>
                    <th className="px-3 py-2 font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summaries.map((summary) => (
                    <tr key={summary.staffId}>
                      <td className="px-3 py-2">{summary.staffName}{!summary.active && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}</td>
                      <td className="px-3 py-2">{summary.daysWorked}</td>
                      <td className="px-3 py-2 font-medium">{formatINR(summary.totalPay)}</td>
                      <td className="px-3 py-2">
                        <Link className="text-primary underline-offset-4 hover:underline" href={`/api/receipts/staff?staffId=${summary.staffId}&month=${month}`} target="_blank">
                          Payout receipt
                        </Link>
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
                  <Input id="staffName" value={name} onChange={(event) => setName(event.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staffPhone">Phone</Label>
                  <Input id="staffPhone" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
                    <button
                      type="button"
                      aria-label={`Remove ${person.name}`}
                      disabled={updatingStaff === person.id}
                      onClick={() => deleteStaff(person.id)}
                      className="text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-40"
                    >
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

