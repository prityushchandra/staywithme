"use client";

import { useRef, useState } from "react";
import { CldUploadWidget } from "next-cloudinary";
import { ImagePlus, Star, Loader2, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmartImage } from "@/components/smart-image";

// Hosts can attach up to this many photos per listing.
const MAX_PHOTOS = 40;

// Reads a local image file, resizes it to a sensible max dimension, and returns
// a compressed JPEG data URL — so photos can be uploaded with NO external
// service. (Cloudinary is still used when configured.)
// Smaller max dimension + quality keeps the stored data URL small, so saving a
// listing (which writes the images to the database) stays fast.
function fileToCompressedDataUrl(
  file: File,
  maxDim = 800,
  quality = 0.52
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ImageUploader({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset =
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? "mybnb_listings";

  const full = value.length >= MAX_PHOTOS;

  function add(url: string) {
    const u = url.trim();
    if (u && !value.includes(u) && value.length < MAX_PHOTOS) onChange([...value, u]);
  }

  function remove(url: string) {
    onChange(value.filter((u) => u !== url));
  }

  // Drag-and-drop reorder: pull the dragged photo out and drop it at `to`.
  // Driven by Pointer Events (below) so it works with both touch and a mouse —
  // the HTML5 drag-and-drop API does not fire from touch gestures on mobile.
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) {
      return;
    }
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  // Drag handle: capture the pointer so we keep getting move/up events even when
  // the finger leaves the handle; figure out which tile is under the finger via
  // hit-testing, then reorder on release.
  function startDrag(e: React.PointerEvent, idx: number) {
    e.preventDefault();
    setDragIndex(idx);
    setOverIndex(idx);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported — drag still works while over the handle */
    }
  }

  function onHandleMove(e: React.PointerEvent) {
    if (dragIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tile = el?.closest<HTMLElement>("[data-photo-index]");
    if (!tile) return;
    const to = Number(tile.dataset.photoIndex);
    if (!Number.isNaN(to) && to !== overIndex) setOverIndex(to);
  }

  function endDrag(e: React.PointerEvent) {
    if (dragIndex !== null && overIndex !== null) reorder(dragIndex, overIndex);
    setDragIndex(null);
    setOverIndex(null);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* nothing to release */
    }
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const next = [...value];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break;
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await fileToCompressedDataUrl(file);
        if (!next.includes(dataUrl)) next.push(dataUrl);
      }
      onChange(next.slice(0, MAX_PHOTOS));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Local upload — works with no external service */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || full}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          Upload photos
        </Button>

        {/* Optional Cloudinary widget when configured */}
        {cloudName && (
          <CldUploadWidget
            uploadPreset={preset}
            options={{ multiple: true, maxFiles: MAX_PHOTOS, sources: ["local"] }}
            onSuccess={(result) => {
              const info = result.info;
              if (info && typeof info === "object" && "secure_url" in info) {
                add(info.secure_url as string);
              }
            }}
          >
            {({ open }) => (
              <Button
                type="button"
                variant="secondary"
                disabled={full}
                onClick={() => open()}
              >
                Upload via Cloudinary
              </Button>
            )}
          </CldUploadWidget>
        )}

        <span className="text-xs text-muted-foreground">
          {value.length}/{MAX_PHOTOS} photos
        </span>
      </div>

      {value.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            The first photo is your cover. Drag the{" "}
            <GripVertical className="inline h-3.5 w-3.5 align-text-bottom" /> handle
            to rearrange photos; tap ✕ to remove one.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {value.map((url, idx) => (
              <div
                key={url}
                data-photo-index={idx}
                className={`relative aspect-square select-none overflow-hidden rounded-lg bg-muted transition-opacity ${
                  overIndex === idx && dragIndex !== null && dragIndex !== idx
                    ? "ring-2 ring-brand ring-offset-1"
                    : ""
                } ${dragIndex === idx ? "opacity-40" : ""}`}
              >
                <SmartImage
                  src={url}
                  alt={`Photo ${idx + 1}`}
                  fill
                  sizes="120px"
                  draggable={false}
                  className="pointer-events-none object-cover"
                />
                {idx === 0 && (
                  <span className="absolute left-1 top-1 z-10 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                    <Star className="h-2.5 w-2.5 fill-current" /> Cover
                  </span>
                )}

                {/* Remove — always visible (touch devices have no hover) */}
                <button
                  type="button"
                  aria-label={`Remove photo ${idx + 1}`}
                  onClick={() => remove(url)}
                  className="absolute right-1 top-1 z-20 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {/* Drag handle — Pointer Events so it works on touch and mouse.
                    touch-none keeps the gesture a drag (not a page scroll). */}
                <button
                  type="button"
                  aria-label={`Drag photo ${idx + 1} to reorder`}
                  onPointerDown={(e) => startDrag(e, idx)}
                  onPointerMove={onHandleMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute bottom-1 right-1 z-20 grid h-7 w-7 cursor-grab touch-none place-items-center rounded-md bg-black/60 text-white active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
