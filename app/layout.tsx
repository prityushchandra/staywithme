import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: {
    default: "StayWithMe — Find your next stay",
    template: "%s · StayWithMe",
  },
  description:
    "Discover handpicked homes for every trip — comfortable stays at honest prices.",
};

// Fit the device width and start at 1x; users can still pinch-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body>
        <Providers>
          <Navbar />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
          <footer className="border-t py-8 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} StayWithMe
          </footer>
        </Providers>
      </body>
    </html>
  );
}
