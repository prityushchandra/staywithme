import type { MetadataRoute } from "next";

// Static: the manifest never varies by request, unlike the rest of the app.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "StayWithMe — Find your next stay",
    short_name: "StayWithMe",
    description:
      "Discover handpicked homes for every trip — comfortable stays at honest prices.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the retro intro's field so the launch never flashes white.
    background_color: "#140F0D",
    theme_color: "#F1ECE4",
    categories: ["travel", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
