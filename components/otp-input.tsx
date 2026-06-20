"use client";

import { useRef } from "react";

// Six oval boxes, one digit each. Auto-advances on type, steps back on
// backspace, supports paste, and arrow-key navigation. No placeholder.
export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const focus = (i: number) =>
    refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  function handleChange(i: number, raw: string) {
    const d = raw.replace(/\D/g, "");
    const chars = value.split("");
    if (d === "") {
      chars[i] = "";
      onChange(chars.join(""));
      return;
    }
    chars[i] = d[d.length - 1];
    onChange(chars.join("").slice(0, length));
    focus(i + 1);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      e.preventDefault();
      const chars = value.split("");
      chars[i - 1] = "";
      onChange(chars.join(""));
      focus(i - 1);
    } else if (e.key === "ArrowLeft") {
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      focus(i + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focus(pasted.length);
  }

  return (
    <div className="flex gap-2" onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="h-12 min-w-0 flex-1 rounded-full border border-input bg-background text-center text-lg font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-ring"
        />
      ))}
    </div>
  );
}
