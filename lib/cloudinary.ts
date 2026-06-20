import { v2 as cloudinary } from "cloudinary";

// Server-side Cloudinary config (used for optional deletes / signed ops).
// Image UPLOADS happen client-side via an unsigned preset (next-cloudinary),
// so the public cloud name + preset are the only values the browser needs.
cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

export const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
export const UPLOAD_PRESET =
  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? "mybnb_listings";
