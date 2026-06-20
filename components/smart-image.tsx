import Image, { type ImageProps } from "next/image";

// Wraps next/image so locally-uploaded images (data: URLs) bypass the optimizer
// (which only handles http/https sources), while remote images (Unsplash,
// Cloudinary) are still optimized normally.
export function SmartImage(props: ImageProps) {
  const isDataUrl = typeof props.src === "string" && props.src.startsWith("data:");
  return <Image {...props} unoptimized={isDataUrl || props.unoptimized} />;
}
