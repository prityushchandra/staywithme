"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, TicketPercent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatINR, minimumStayMessage } from "@/lib/pricing";

type ListingOption = { id: string; label: string; basePrice: number; minimumNights: number | null };
type Coupon = {
  id: string; code: string; kind: "DAILY" | "MONTHLY"; amount: number; active: boolean;
  listingLabel: string; createdAt: string; reserved: boolean; paid: boolean; bookingId: string | null;
};

export function CouponCreator({ listings, coupons }: { listings: ListingOption[]; coupons: Coupon[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [kind, setKind] = useState<"DAILY" | "MONTHLY">("DAILY");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = listings.find((listing) => listing.id === listingId);
  const minimum = Math.max(selected?.minimumNights ?? 1, kind === "MONTHLY" ? 30 : 1);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/admin/coupons", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, kind, amount: Math.round(Number(amount) * 100), code: code.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create the coupon.");
      toast(`Coupon created: ${data.code}`);
      setCode("");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create the coupon. Please retry.");
    } finally { setBusy(null); }
  }

  async function toggle(coupon: Coupon) {
    setBusy(coupon.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/coupons/${encodeURIComponent(coupon.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !coupon.active }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the coupon.");
      toast(coupon.active ? "Coupon paused" : "Coupon enabled");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the coupon. Please retry.");
    } finally { setBusy(null); }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("Coupon code copied");
    } catch {
      setError(`Could not copy the code automatically. Select and copy ${code}.`);
    }
  }

  return (
    <div className="space-y-6">
      {listings.length ? (
        <form onSubmit={create} className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 sm:p-5">
          <div className="space-y-1">
            <Label htmlFor="coupon-listing">Listing</Label>
            <select id="coupon-listing" value={listingId} onChange={(event) => setListingId(event.target.value)}
              disabled={busy !== null} className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
              {listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.label}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="coupon-kind">Coupon type</Label>
              <select id="coupon-kind" value={kind} disabled={busy !== null}
                onChange={(event) => setKind(event.target.value === "MONTHLY" ? "MONTHLY" : "DAILY")}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                <option value="DAILY">Daily - fixed price per night</option>
                <option value="MONTHLY">Monthly - fixed price for 30 nights</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="coupon-amount">{kind === "MONTHLY" ? "Amount for 30 nights (INR)" : "Price per night (INR)"}</Label>
              <Input id="coupon-amount" type="number" inputMode="decimal" min="1" step="0.01"
                required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy !== null} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="coupon-code">Coupon code - optional</Label>
            <Input id="coupon-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="Leave blank to generate a code" maxLength={32} disabled={busy !== null}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            <p className="text-xs text-muted-foreground">4-32 letters, numbers or hyphens. Codes are not case-sensitive.</p>
          </div>
          <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium">{minimumStayMessage(minimum)}</p>
            {selected && <p>Regular price: {formatINR(selected.basePrice * (kind === "MONTHLY" ? 30 : 1))}{kind === "MONTHLY" ? " / 30 nights" : " / night"}</p>}
            <p className="text-muted-foreground">
              {kind === "MONTHLY" ? "Extra nights use amount / 30. " : ""}
              Platform Fee is added separately. This code replaces all other listing discounts.
            </p>
            <p className="text-xs text-muted-foreground">
              Single use across all guests. Pay now permanently reserves the code to that booking;
              the same booking can retry, but abandoning or cancelling it does not release the code.
            </p>
          </div>
          <Button type="submit" disabled={busy !== null}>
            <TicketPercent className="mr-2 h-4 w-4" />{busy === "create" ? "Creating..." : "Create coupon"}
          </Button>
        </form>
      ) : <p className="rounded-xl border border-dashed p-6 text-muted-foreground">Publish a listing before creating a coupon.</p>}

      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recent coupons</h2>
          <p className="text-xs text-muted-foreground">Latest 100 codes. Reserved and used codes cannot be changed.</p>
        </div>
        {coupons.length === 0 && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No coupons yet.</p>}
        {coupons.map((coupon) => (
          <article key={coupon.id} className="min-w-0 space-y-3 rounded-xl border p-4 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-semibold">{coupon.code}</code>
              <button type="button" onClick={() => void copy(coupon.code)} aria-label={`Copy ${coupon.code}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Copy className="h-4 w-4" /></button>
              <Badge variant={coupon.paid ? "success" : "secondary"}>
                {coupon.paid ? "Used" : coupon.reserved ? "Reserved" : coupon.active ? "Available" : "Paused"}
              </Badge>
            </div>
            <p className="text-sm">{coupon.listingLabel}</p>
            <p className="font-medium">
              {coupon.kind === "MONTHLY" ? "Monthly" : "Daily"}: {formatINR(coupon.amount)}
              {coupon.kind === "MONTHLY" ? " / 30 nights, prorated" : " / night"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">+ Platform Fee</span>
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Created {new Date(coupon.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
              {coupon.bookingId && <span>Booking #{coupon.bookingId.slice(-6)}</span>}
              {!coupon.reserved && (
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void toggle(coupon)}>
                  {busy === coupon.id ? "Saving..." : coupon.active ? "Pause coupon" : "Enable coupon"}
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
