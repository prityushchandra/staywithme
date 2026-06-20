"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Grip } from "lucide-react";
import { SmartImage } from "@/components/smart-image";
import { SwipeCarousel } from "@/components/swipe-carousel";

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
      className={`relative overflow-hidden bg-muted transition hover:brightness-95 ${className}`}
    >
      <SmartImage
        src={images[idx].url}
        alt={`${title} photo ${idx + 1}`}
        fill
        sizes={sizes}
        className="object-cover"
        priority={idx === 0}
      />
    </button>
  );

  if (count === 0) {
    return (
      <div className="mt-4 flex aspect-[16/9] items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        No photos yet
      </div>
    );
  }

  return (
    <>
      <div className="relative mt-4 duration-500 animate-in fade-in">
        {/* Mobile: smooth swipeable hero. Tap opens the fullscreen viewer. */}
        <div className="sm:hidden">
          <SwipeCarousel
            images={images}
            title={title}
            className="aspect-[4/3] w-full rounded-2xl bg-muted"
            onTap={(i) => show(i)}
            showDots
            showCounter
          />
        </div>

        {/* Desktop: mosaic adapts to the photo count so there are never empty cells. */}
        <div className="hidden sm:block">
          {count === 1 && (
            <div className="aspect-[16/9] overflow-hidden rounded-2xl">
              {renderImg(0, "h-full w-full", "100vw")}
            </div>
          )}
          {count === 2 && (
            <div className="grid aspect-[2/1] grid-cols-2 gap-2 overflow-hidden rounded-2xl">
              {renderImg(0, "")}
              {renderImg(1, "")}
            </div>
          )}
          {count === 3 && (
            <div className="grid aspect-[2/1] grid-cols-3 grid-rows-2 gap-2 overflow-hidden rounded-2xl">
              {renderImg(0, "col-span-2 row-span-2")}
              {renderImg(1, "")}
              {renderImg(2, "")}
            </div>
          )}
          {count === 4 && (
            <div className="grid aspect-[3/2] grid-cols-2 grid-rows-2 gap-2 overflow-hidden rounded-2xl">
              {[0, 1, 2, 3].map((i) => renderImg(i, ""))}
            </div>
          )}
          {count >= 5 && (
            <div className="grid aspect-[2/1] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl">
              {renderImg(0, "col-span-2 row-span-2")}
              {renderImg(1, "")}
              {renderImg(2, "")}
              {renderImg(3, "")}
              {renderImg(4, "")}
            </div>
          )}
        </div>

        {count > 1 && (
          <button
            type="button"
            onClick={() => show(index)}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-neutral-50"
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
