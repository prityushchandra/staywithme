"use client";

import { useRef, useState } from "react";
import { CldUploadWidget } from "next-cloudinary";
import { ImagePlus, Star, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
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

  // Reorder: swap a photo with its neighbour. Index 0 is the cover.
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  // Drag-and-drop reorder: pull the dragged photo out and drop it at `to`.
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) {
      return;
    }
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
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
            The first photo is your cover. Drag photos to rearrange them (or use
            the arrows); hover a photo to remove it.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {value.map((url, idx) => (
              <div
                key={url}
                draggable
                onDragStart={(e) => {
                  setDragIndex(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== idx) setOverIndex(idx);
                }}
                onDragLeave={() => {
                  if (overIndex === idx) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) reorder(dragIndex, idx);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`group relative aspect-square cursor-grab select-none overflow-hidden rounded-lg bg-muted active:cursor-grabbing ${
                  overIndex === idx && dragIndex !== idx
                    ? "ring-2 ring-brand ring-offset-1"
                    : ""
                } ${dragIndex === idx ? "opacity-50" : ""}`}
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

                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move earlier"
                      disabled={idx === 0}
                      onClick={() => move(idx, -1)}
                      className="rounded bg-white/90 p-1 text-black hover:bg-white disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move later"
                      disabled={idx === value.length - 1}
                      onClick={() => move(idx, 1)}
                      className="rounded bg-white/90 p-1 text-black hover:bg-white disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    className="rounded bg-white/90 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-white"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
