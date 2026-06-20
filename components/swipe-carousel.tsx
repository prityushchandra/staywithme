"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SmartImage } from "@/components/smart-image";
import { cn } from "@/lib/utils";

type Img = { id: string; url: string };

// Finger-following sliding carousel (Airbnb-style). The track is a row of
// full-width slides; during a drag we translate it by the live pixel offset so
// the photo tracks the finger, then snap to the nearest slide with an eased
// transition on release. No re-mount/fade, so swiping feels smooth and
// continuous. `index`/`onIndexChange` make it controllable (used by the
// fullscreen viewer); left uncontrolled it manages its own index.
export function SwipeCarousel({
  images,
  title,
  fit = "cover",
  className,
  index: controlledIndex,
  onIndexChange,
  onTap,
  showArrows = false,
  showDots = false,
  showCounter = false,
}: {
  images: Img[];
  title: string;
  fit?: "cover" | "contain";
  className?: string;
  index?: number;
  onIndexChange?: (i: number) => void;
  onTap?: (i: number) => void;
  showArrows?: boolean;
  showDots?: boolean;
  showCounter?: boolean;
}) {
  const [internal, setInternal] = useState(0);
  const index = controlledIndex ?? internal;
  const setIndex = (n: number) => {
    const clamped = Math.max(0, Math.min(images.length - 1, n));
    onIndexChange?.(clamped);
    if (controlledIndex === undefined) setInternal(clamped);
  };

  const viewportRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  // Per-gesture axis lock: once a swipe is decided horizontal it drives the
  // carousel; if vertical, we ignore it and let the page scroll normally.
  const axis = useRef<null | "x" | "y">(null);
  const moved = useRef(false);
  const [drag, setDrag] = useState(0);
  const dragging = axis.current === "x";
  const count = images.length;

  function onEnd() {
    if (axis.current === "x") {
      const width = viewportRef.current?.clientWidth ?? 1;
      const threshold = Math.max(40, width * 0.15);
      if (drag < -threshold) setIndex(index + 1);
      else if (drag > threshold) setIndex(index - 1);
    }
    startX.current = null;
    startY.current = null;
    axis.current = null;
    setDrag(0);
  }

  return (
    <div
      ref={viewportRef}
      // touch-pan-y: the browser keeps vertical scrolling; horizontal gestures
      // are ours, so swiping photos never jerks the page up and down.
      className={cn("relative touch-pan-y overflow-hidden select-none", className)}
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
        startY.current = e.touches[0].clientY;
        axis.current = null;
        moved.current = false;
      }}
      onTouchMove={(e) => {
        if (startX.current === null || startY.current === null) return;
        const dx = e.touches[0].clientX - startX.current;
        const dy = e.touches[0].clientY - startY.current;
        if (axis.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (axis.current === "x") {
          moved.current = true;
          setDrag(dx);
        }
      }}
      onTouchEnd={onEnd}
      onClick={() => {
        if (!moved.current) onTap?.(index);
      }}
    >
      <div
        className="flex h-full"
        style={{
          transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
          transition: dragging
            ? "none"
            : "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {images.map((img, i) => (
          <div key={img.id} className="relative h-full w-full shrink-0">
            <SmartImage
              src={img.url}
              alt={`${title} photo ${i + 1}`}
              fill
              sizes="100vw"
              priority={i === 0}
              draggable={false}
              className={fit === "contain" ? "object-contain" : "object-cover"}
            />
          </div>
        ))}
      </div>

      {showArrows && count > 1 && (
        <>
          {index > 0 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => {
                e.stopPropagation();
                setIndex(index - 1);
              }}
              className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white sm:block"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {index < count - 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => {
                e.stopPropagation();
                setIndex(index + 1);
              }}
              className="absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white sm:block"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </>
      )}

      {showDots && count > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          {images.map((img, i) => (
            <span
              key={img.id}
              className={cn(
                "h-1.5 rounded-full bg-white transition-all duration-300",
                i === index ? "w-4 opacity-100" : "w-1.5 opacity-60"
              )}
            />
          ))}
        </div>
      )}

      {showCounter && count > 1 && (
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white">
          {index + 1} / {count}
        </span>
      )}
    </div>
  );
}
