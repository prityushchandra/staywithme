"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/date-range-picker";
import { cn } from "@/lib/utils";

const ROOM_TYPES = [
  { value: "ENTIRE", label: "Entire place" },
  { value: "PRIVATE", label: "Private room" },
  { value: "SHARED", label: "Shared room" },
];

type Amenity = { key: string; label: string };

export function SearchFilters({
  amenities,
  onApplied,
}: {
  amenities: Amenity[];
  onApplied?: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [checkIn, setCheckIn] = useState(params.get("checkIn") ?? "");
  const [checkOut, setCheckOut] = useState(params.get("checkOut") ?? "");
  const [minPrice, setMinPrice] = useState(params.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(params.get("maxPrice") ?? "");
  const [roomType, setRoomType] = useState<string[]>(params.getAll("roomType"));
  const [bedrooms, setBedrooms] = useState(Number(params.get("bedrooms") ?? 0));
  const [bathrooms, setBathrooms] = useState(Number(params.get("bathrooms") ?? 0));
  const [amenityKeys, setAmenityKeys] = useState<string[]>(params.getAll("amenities"));

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function apply() {
    const next = new URLSearchParams();
    // Preserve the top search context.
    for (const key of ["destination", "guests"]) {
      const v = params.get(key);
      if (v) next.set(key, v);
    }
    if (checkIn && checkOut) {
      next.set("checkIn", checkIn);
      next.set("checkOut", checkOut);
    }
    if (minPrice) next.set("minPrice", minPrice);
    if (maxPrice) next.set("maxPrice", maxPrice);
    if (bedrooms > 0) next.set("bedrooms", String(bedrooms));
    if (bathrooms > 0) next.set("bathrooms", String(bathrooms));
    roomType.forEach((r) => next.append("roomType", r));
    amenityKeys.forEach((a) => next.append("amenities", a));
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
    onApplied?.();
  }

  function clearAll() {
    setCheckIn("");
    setCheckOut("");
    setMinPrice("");
    setMaxPrice("");
    setRoomType([]);
    setBedrooms(0);
    setBathrooms(0);
    setAmenityKeys([]);
    const next = new URLSearchParams();
    for (const key of ["destination", "guests"]) {
      const v = params.get(key);
      if (v) next.set(key, v);
    }
    router.push(`/search?${next.toString()}`);
    onApplied?.();
  }

  const Stepper = ({
    label,
    value,
    setValue,
  }: {
    label: string;
    value: number;
    setValue: (n: number) => void;
  }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setValue(Math.max(0, value - 1))}
          className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-40"
          disabled={value <= 0}
        >
          −
        </button>
        <span className="w-8 text-center text-sm">{value === 0 ? "Any" : `${value}+`}</span>
        <button
          type="button"
          onClick={() => setValue(value + 1)}
          className="grid h-8 w-8 place-items-center rounded-full border"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Dates</Label>
        <DateRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={(ci, co) => {
            setCheckIn(ci);
            setCheckOut(co);
          }}
          variant="card"
        />
      </div>

      <div className="space-y-2">
        <Label>Price range (₹ total / night)</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            placeholder="Min"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            placeholder="Max"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Type of place</Label>
        <div className="flex flex-wrap gap-2">
          {ROOM_TYPES.map((rt) => (
            <button
              key={rt.value}
              type="button"
              onClick={() => toggle(roomType, setRoomType, rt.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                roomType.includes(rt.value)
                  ? "border-foreground bg-foreground text-background"
                  : "hover:border-foreground"
              )}
            >
              {rt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label>Rooms</Label>
        <Stepper label="Bedrooms" value={bedrooms} setValue={setBedrooms} />
        <Stepper label="Bathrooms" value={bathrooms} setValue={setBathrooms} />
      </div>

      <div className="space-y-2">
        <Label>Amenities</Label>
        <div className="flex flex-wrap gap-2">
          {amenities.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => toggle(amenityKeys, setAmenityKeys, a.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                amenityKeys.includes(a.key)
                  ? "border-foreground bg-foreground text-background"
                  : "hover:border-foreground"
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button variant="brand" onClick={apply} className="flex-1">
          Show results
        </Button>
        <Button variant="ghost" onClick={clearAll}>
          Clear
        </Button>
      </div>
    </div>
  );
}
