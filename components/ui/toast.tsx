"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A tiny dependency-free toast: a provider that owns the queue, a `useToast()`
// hook for anywhere in the tree, and one always-mounted live region so screen
// readers announce messages that appear after load.
//
// The viewport is anchored bottom-centre and lifted clear of the floating
// booking tab on compact screens (that tab is `fixed inset-x-0 bottom-0 z-40`
// with safe-area padding), so a toast never hides behind it.

/** How long a toast stays up before it dismisses itself. */
const TOAST_DURATION_MS = 3000;
/** Oldest toasts fall off the stack beyond this. */
const MAX_TOASTS = 3;
/** Clearance for the floating booking tab plus a little breathing room. */
const COMPACT_BOTTOM_GAP = "pb-[calc(env(safe-area-inset-bottom)_+_6rem)]";

export type ToastOptions = { duration?: number };

type ToastItem = {
  id: number;
  message: string;
  duration: number;
  /** Bumped when the same message is raised again, to restart its countdown. */
  seq: number;
};

type ToastApi = {
  /** Show a transient message. Re-raising the same text refreshes it in place. */
  toast: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const duration = options?.duration ?? TOAST_DURATION_MS;
    const id = nextId.current++;
    setToasts((prev) => {
      // Mashing the same button shouldn't stack identical pills.
      if (prev.some((t) => t.message === message)) {
        return prev.map((t) =>
          t.message === message ? { ...t, duration, seq: t.seq + 1 } : t
        );
      }
      return [...prev, { id, message, duration, seq: 0 }].slice(-MAX_TOASTS);
    });
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {/* Mounted even when empty: a live region has to exist before its content
          changes for the announcement to be made. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-3",
          COMPACT_BOTTOM_GAP,
          "lg:pb-6"
        )}
      >
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { id, duration, seq } = item;

  useEffect(() => {
    const handle = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(handle);
  }, [id, duration, seq, onDismiss]);

  return (
    <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-foreground/95 px-4 py-3 text-sm font-medium text-background shadow-[0_8px_30px_rgba(0,0,0,0.24)] backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      <span className="min-w-0 flex-1">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="-mr-1 shrink-0 rounded-full p-1 opacity-70 transition hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
