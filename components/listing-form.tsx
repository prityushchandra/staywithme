"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PriceInsight } from "@/components/price-insight";
import { ImageUploader } from "@/components/image-uploader";
import { listingInputSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";

const ROOM_TYPES = [
  { value: "ENTIRE", label: "Entire place", hint: "Guests have the whole place to themselves" },
  { value: "PRIVATE", label: "Private room", hint: "A private room in a shared space" },
  { value: "SHARED", label: "Shared room", hint: "A shared sleeping space" },
] as const;

const CHECK_IN_TIMES = [
  "Flexible",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "After 6:00 PM",
];
const CHECK_OUT_TIMES = ["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "Flexible"];

// The society's blocks/towers — fixed list (guests never see these).
const BLOCK_NAMES = ["Paradise", "Halcyon", "Tranquil", "Eden", "Serene"];

type Amenity = { key: string; label: string };
type Policy = { policy: string; title: string; description: string };

export interface ListingFormInitial {
  title: string;
  description: string;
  hostDisplayName: string;
  propertyType: string;
  roomType: string;
  addressLine: string;
  city: string;
  country: string;
  flatNumber: string;
  block: string;
  bedrooms: number;
  bathrooms: number;
  beds: number;
  maxGuests: number;
  maxInfants?: number;
  basePriceRupees: number;
  monthlyPriceRupees?: number;
  cancellationPolicy: string;
  checkInTime?: string;
  checkOutTime?: string;
  houseRules?: string;
  amenityKeys: string[];
  imageUrls: string[];
}

export function ListingForm({
  amenities,
  policies,
  suggestedMinPaise,
  suggestedMaxPaise,
  initial,
  listingId,
}: {
  amenities: Amenity[];
  policies: Policy[];
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
  initial?: ListingFormInitial;
  listingId?: string;
}) {
  const router = useRouter();
  const { data: session, update } = useSession();
  const isEdit = !!listingId;
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    hostDisplayName: initial?.hostDisplayName ?? "",
    propertyType: initial?.propertyType ?? "APARTMENT",
    roomType: initial?.roomType ?? "ENTIRE",
    // Location section is hidden for now (single society) — defaults keep the
    // record valid; existing listings keep their saved values when editing.
    addressLine: initial?.addressLine ?? "StayWithMe Society",
    city: initial?.city ?? "Bengaluru",
    country: initial?.country ?? "India",
    flatNumber: initial?.flatNumber ?? "",
    block: initial?.block ?? "",
    bedrooms: initial?.bedrooms ?? 1,
    bathrooms: initial?.bathrooms ?? 1,
    beds: initial?.beds ?? 1,
    maxGuests: initial?.maxGuests ?? 2,
    maxInfants: initial?.maxInfants ?? 0,
    basePriceRupees: initial?.basePriceRupees ?? 0,
    monthlyPriceRupees: initial?.monthlyPriceRupees ?? 0,
    cancellationPolicy: initial?.cancellationPolicy ?? policies[0]?.policy ?? "FLEXIBLE",
    checkInTime: initial?.checkInTime ?? "",
    checkOutTime: initial?.checkOutTime ?? "",
    houseRules: initial?.houseRules ?? "",
  });
  const [amenityKeys, setAmenityKeys] = useState<string[]>(initial?.amenityKeys ?? []);
  const [imageUrls, setImageUrls] = useState<string[]>(initial?.imageUrls ?? []);

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function toggleAmenity(key: string) {
    setAmenityKeys((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const payload = { ...form, amenityKeys, imageUrls };
    const parsed = listingInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        isEdit ? `/api/listings/${listingId}` : "/api/listings",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }
      );

      if (!res.ok) {
        setSubmitting(false);
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save listing.");
        return;
      }

      // Saved — go back to the dashboard the editor was opened from. Admins
      // moderating a listing return to the admin list; hosts go to their own.
      // Refresh the session in the background (so the navbar picks up the new
      // HOST role) instead of blocking the redirect on it.
      void update();
      router.push(session?.user?.isAdmin ? "/admin/listings" : "/host");
      router.refresh();
    } catch {
      setSubmitting(false);
      setError("Something went wrong. Check your connection and try again.");
    }
  }

  // Airbnb-style counter row (− value +), with hard min/max bounds.
  const counter = (
    key: "bedrooms" | "bathrooms" | "beds" | "maxGuests" | "maxInfants",
    label: string,
    min: number,
    max: number
  ) => (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={form[key] <= min}
          onClick={() => set(key, form[key] - 1)}
          className="grid h-8 w-8 place-items-center rounded-full border text-lg leading-none disabled:opacity-40"
        >
          −
        </button>
        <span className="w-6 text-center text-sm tabular-nums">{form[key]}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={form[key] >= max}
          onClick={() => set(key, form[key] + 1)}
          className="grid h-8 w-8 place-items-center rounded-full border text-lg leading-none disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Basics */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Tell us about your place</h2>
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Rest, Relax, Refresh"
            maxLength={40}
          />
          <p className="text-right text-xs text-muted-foreground">
            {form.title.length}/40
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Describe your space, the neighbourhood, and what makes it special."
            rows={5}
            maxLength={4000}
          />
          <p className="text-right text-xs text-muted-foreground">
            {form.description.length}/4000
          </p>
        </div>
        <div className="space-y-2">
          <Label>Room type</Label>
          <RadioGroup
            value={form.roomType}
            onValueChange={(v) => set("roomType", v)}
            className="grid gap-2 sm:grid-cols-3"
          >
            {ROOM_TYPES.map((rt) => (
              <label
                key={rt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border p-3",
                  form.roomType === rt.value && "border-brand ring-1 ring-brand"
                )}
              >
                <RadioGroupItem value={rt.value} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{rt.label}</span>
                  <span className="block text-xs text-muted-foreground">{rt.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
      </section>

      {/* Capacity */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Rooms & guests</h2>
        <div className="divide-y rounded-xl border sm:max-w-md">
          {counter("bedrooms", "Bedrooms", 1, 4)}
          {counter("beds", "Beds", 1, 4)}
          {counter("bathrooms", "Bathrooms", 1, 4)}
          {counter("maxGuests", "Max guests", 1, 20)}
          {counter("maxInfants", "Max infants", 0, 10)}
        </div>
      </section>

      {/* Private address — admin only, never shown to guests */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Private address</h2>
        <p className="text-sm text-muted-foreground">
          Your exact unit, for the platform only. This is{" "}
          <span className="font-medium text-foreground">never shown to guests</span> —
          only the admin team can see it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="flatNumber">Flat / unit number</Label>
            <Input
              id="flatNumber"
              value={form.flatNumber}
              onChange={(e) => set("flatNumber", e.target.value.toUpperCase())}
              placeholder="L1234"
              maxLength={5}
            />
            <p className="text-xs text-muted-foreground">
              One letter then 4 digits, e.g. L1234
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="block">Block / tower</Label>
            <select
              id="block"
              value={form.block}
              onChange={(e) => set("block", e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select block</option>
              {BLOCK_NAMES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Things guests should know */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Things guests should know</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="checkInTime">Check-in time</Label>
            <select
              id="checkInTime"
              value={form.checkInTime}
              onChange={(e) => set("checkInTime", e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select check-in time</option>
              {CHECK_IN_TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkOutTime">Checkout time</Label>
            <select
              id="checkOutTime"
              value={form.checkOutTime}
              onChange={(e) => set("checkOutTime", e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select checkout time</option>
              {CHECK_OUT_TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="houseRules">House rules</Label>
          <Textarea
            id="houseRules"
            value={form.houseRules}
            onChange={(e) => set("houseRules", e.target.value)}
            placeholder={"One per line, e.g.\nNo smoking\nNo parties or events\nPets allowed on request"}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Shown to guests under “Things to know”. One rule per line.
          </p>
        </div>
      </section>

      {/* Amenities */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Amenities</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {amenities.map((a) => (
            <label
              key={a.key}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm",
                amenityKeys.includes(a.key) && "border-brand ring-1 ring-brand"
              )}
            >
              <input
                type="checkbox"
                checked={amenityKeys.includes(a.key)}
                onChange={() => toggleAmenity(a.key)}
              />
              {a.label}
            </label>
          ))}
        </div>
      </section>

      {/* Photos */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Photos</h2>
        <p className="text-sm text-muted-foreground">
          The first photo is your cover. Add at least one.
        </p>
        <ImageUploader value={imageUrls} onChange={setImageUrls} />
      </section>

      {/* Pricing */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="price">Base price per night (₹)</Label>
            <Input
              id="price"
              type="number"
              min={1}
              value={form.basePriceRupees || ""}
              onChange={(e) => set("basePriceRupees", Number(e.target.value) || 0)}
              placeholder="2400"
            />
            <p className="text-xs text-muted-foreground">
              Guests see this plus the platform fee. You set only the base price.
            </p>
          </div>
          <div className="flex items-end">
            <div className="w-full">
              <PriceInsight
                basePriceRupees={form.basePriceRupees}
                suggestedMinPaise={suggestedMinPaise}
                suggestedMaxPaise={suggestedMaxPaise}
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="monthlyPrice">Monthly price (₹) — optional</Label>
          <Input
            id="monthlyPrice"
            type="number"
            min={0}
            value={form.monthlyPriceRupees || ""}
            onChange={(e) => set("monthlyPriceRupees", Number(e.target.value) || 0)}
            placeholder="45000"
          />
          <p className="text-xs text-muted-foreground">
            For long stays. When set, bookings of 30 nights or more are charged at
            this monthly rate (pro-rated per night) instead of the nightly price.
            Leave blank if you don&apos;t offer monthly stays.
          </p>
        </div>
      </section>

      {/* Cancellation policy */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cancellation policy</h2>
        <p className="text-sm text-muted-foreground">
          Choose one. This is shown to guests; cancellations are coordinated with
          the platform.
        </p>
        <RadioGroup
          value={form.cancellationPolicy}
          onValueChange={(v) => set("cancellationPolicy", v)}
          className="grid gap-2 sm:grid-cols-3"
        >
          {policies.map((p) => (
            <label
              key={p.policy}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3",
                form.cancellationPolicy === p.policy && "border-brand ring-1 ring-brand"
              )}
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem value={p.policy} />
                <span className="text-sm font-medium">{p.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">{p.description}</span>
            </label>
          ))}
        </RadioGroup>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3 border-t pt-6">
        <Button type="submit" variant="brand" size="lg" disabled={submitting}>
          {submitting
            ? "Saving…"
            : isEdit
              ? "Save & resubmit for approval"
              : "Submit for approval"}
        </Button>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? "Editing sends the listing back to admin moderation."
            : "Your listing goes to admin moderation before it's published."}
        </p>
      </div>
    </form>
  );
}
