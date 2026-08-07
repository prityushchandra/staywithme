"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Thin convenience wrapper around Select. The toggle-on-second-click behaviour
// now lives in the base Select/SelectTrigger, so this just saves boilerplate.
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
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
