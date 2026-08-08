import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/navbar";
import { TrackVisit } from "@/components/track-visit";
import { AppIntro } from "@/components/app-intro";
import { appleSplashLinks } from "@/lib/apple-splash";
import { getPlatformSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: {
    default: "StayWithMe — Find your next stay",
    template: "%s · StayWithMe",
  },
  description:
    "Discover handpicked homes for every trip — comfortable stays at honest prices.",
  applicationName: "StayWithMe",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "StayWithMe",
    statusBarStyle: "default",
    startupImage: appleSplashLinks(),
  },
};

// Fit the device width and start at 1x; users can still pinch-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F1ECE4",
};

/**
 * Runs before the overlay markup is parsed so the intro can never flash in a
 * browser tab. Skipped inside the Capacitor shells, which show their own
 * splash, and after the first load of a session.
 */
const INTRO_BOOT = `try{if(!window.Capacitor&&(window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches)&&!sessionStorage.getItem('swm-intro')){document.documentElement.dataset.swmIntro='1';sessionStorage.setItem('swm-intro','1')}}catch(e){}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getPlatformSettings();
  return (
    <html lang="en" className="scroll-smooth">
      <body>
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
        <AppIntro />
        <Providers>
          <Navbar showSignature={settings.showSignature} whatsappNumber={settings.whatsappNumber} />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
          <footer className="border-t py-8 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} StayWithMe
          </footer>
        </Providers>
        <SpeedInsights />
        <Analytics />
        <TrackVisit />
      </body>
    </html>
  );
}
