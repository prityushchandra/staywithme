"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Grip } from "lucide-react";
import { SmartImage } from "@/components/smart-image";
import { SwipeCarousel } from "@/components/swipe-carousel";
import { useOverlayHistory } from "@/lib/use-overlay-history";

type Img = { id: string; url: string };

// Detail-page gallery: a swipeable hero on mobile and a responsive mosaic on
// desktop, both opening a fullscreen viewer with smooth finger-following swipe
// and keyboard (←/→/Esc) navigation.
export function Gallery({ images, title }: { images: Img[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const count = images.length;
  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  const go = useCallback(
    (next: number) => setIndex((i) => Math.max(0, Math.min(count - 1, next ?? i))),
    [count]
  );

  const close = useCallback(() => setOpen(false), []);
  // The viewer covers the whole screen, so Back should dismiss it rather than
  // abandoning the listing.
  useOverlayHistory(open, close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, index, go]);

  const renderImg = (idx: number, className: string, sizes = "50vw") => (
    <button
      key={images[idx].id}
      type="button"
      onClick={() => show(idx)}
      className={`group relative overflow-hidden bg-muted outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-ring ${className}`}
    >
      <SmartImage
        src={images[idx].url}
        alt={`${title} photo ${idx + 1}`}
        fill
        sizes={sizes}
        className="object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.025]"
        priority={idx === 0}
      />
    </button>
  );

  if (count === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-3xl bg-muted text-muted-foreground">
        No photos yet
      </div>
    );
  }

  return (
    <>
      <div className="relative">
        {/* Mobile: smooth swipeable hero. Tap opens the fullscreen viewer. */}
        <div className="sm:hidden">
          <SwipeCarousel
            images={images}
            title={title}
            className="aspect-[4/3] w-full rounded-3xl bg-muted"
            onTap={(i) => show(i)}
            showCounter
          />
        </div>

        {/* Desktop: mosaic adapts to the photo count so there are never empty cells. */}
        <div className="hidden sm:block">
          {count === 1 && (
            <div className="aspect-[2/1] overflow-hidden rounded-[2rem]">
              {renderImg(0, "h-full w-full", "100vw")}
            </div>
          )}
          {count === 2 && (
            <div className="grid aspect-[2.15/1] grid-cols-[1.75fr_1fr] gap-3 overflow-hidden rounded-[2rem]">
              {renderImg(0, "", "(min-width: 1280px) 780px, 65vw")}
              {renderImg(1, "", "(min-width: 1280px) 440px, 35vw")}
            </div>
          )}
          {count >= 3 && (
            <div className="grid aspect-[2.15/1] grid-cols-[1.75fr_1fr] grid-rows-2 gap-3 overflow-hidden rounded-[2rem]">
              {renderImg(0, "row-span-2", "(min-width: 1280px) 780px, 65vw")}
              {renderImg(1, "", "(min-width: 1280px) 440px, 35vw")}
              {renderImg(2, "", "(min-width: 1280px) 440px, 35vw")}
            </div>
          )}
        </div>

        {count > 1 && (
          <button
            type="button"
            onClick={() => show(index)}
            className="absolute bottom-4 right-4 flex min-h-11 items-center gap-2 rounded-full border border-white/60 bg-white/95 px-4 py-2 text-xs font-medium text-neutral-900 shadow-sm backdrop-blur-sm transition hover:bg-white sm:bottom-5 sm:right-5 sm:text-sm"
          >
            <Grip className="h-4 w-4" /> Show all {count} photos
          </button>
        )}
      </div>

      {/* Fullscreen viewer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-black/95"
          >
            <div className="flex items-center justify-between px-4 py-3 text-white">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close gallery"
                className="rounded-full p-2 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
              <span className="text-sm">
                {index + 1} / {count}
              </span>
              <span className="w-9" />
            </div>

            <div className="flex flex-1 items-center justify-center overflow-hidden px-2 pb-6">
              <SwipeCarousel
                images={images}
                title={title}
                fit="contain"
                index={index}
                onIndexChange={setIndex}
                showArrows
                className="h-[78vh] w-full max-w-5xl"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
