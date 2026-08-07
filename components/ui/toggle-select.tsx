"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// A Select whose trigger reliably TOGGLES: clicking it while open closes it.
// Radix's Select trigger only ever opens on pointer-down (it doesn't toggle), so
// a second click can re-open it immediately. Here we control the open state and,
// when it's already open, prevent Radix's re-open and close it ourselves.
export function ToggleSelect({
  value,
  onValueChange,
  triggerClassName,
  placeholder,
  ariaLabel,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Select value={value} onValueChange={onValueChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={triggerClassName}
        onPointerDown={(e) => {
          if (open) {
            // Skip Radix's re-open handler and close explicitly.
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
