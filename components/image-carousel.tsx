"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SmartImage } from "@/components/smart-image";
import { cn } from "@/lib/utils";

// Card carousel. Renders ONLY the current photo (so a card with several photos
// doesn't embed them all — that bloated the page). Arrows on hover (desktop),
// horizontal swipe (touch), dots. `touch-pan-y` lets the browser keep vertical
// scrolling while we handle horizontal swipes, so swiping never jerks the page.
export function ImageCarousel({
  images,
  alt,
  sizes,
}: {
  images: { id: string; url: string }[];
  alt: string;
  sizes?: string;
}) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);

  const count = images.length;
  const go = (next: number) => setIndex((next + count) % count);

  if (count === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
        No image
      </div>
    );
  }

  return (
    <div
      className="group/carousel relative h-full w-full touch-pan-y overflow-hidden"
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (startX.current === null) return;
        const dx = e.changedTouches[0].clientX - startX.current;
        if (Math.abs(dx) > 40) go(dx < 0 ? index + 1 : index - 1);
        startX.current = null;
      }}
    >
      <SmartImage
        key={index}
        src={images[index].url}
        alt={alt}
        fill
        sizes={sizes ?? "(max-width: 768px) 100vw, 25vw"}
        className="object-cover duration-300 animate-in fade-in"
      />

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(index - 1);
            }}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow opacity-0 transition group-hover/carousel:opacity-100 hover:bg-white sm:block"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(index + 1);
            }}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow opacity-0 transition group-hover/carousel:opacity-100 hover:bg-white sm:block"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {images.map((img, i) => (
              <span
                key={img.id}
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-white transition-opacity",
                  i === index ? "opacity-100" : "opacity-50"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
