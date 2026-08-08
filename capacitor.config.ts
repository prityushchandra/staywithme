import type { CapacitorConfig } from "@capacitor/cli";

/**
 * StayWithMe is fully server-rendered (Prisma, NextAuth, API routes), so the
 * native shells load the live site instead of bundling a static export.
 * `native/www` ships the retro splash screen and the offline fallback page
 * referenced by errorPath.
 */
const config: CapacitorConfig = {
  appId: "in.co.staywithme.app",
  appName: "StayWithMe",
  webDir: "native/www",
  server: {
    url: "https://staywithme.co.in",
    androidScheme: "https",
    cleartext: false,
    errorPath: "offline.html",
  },
  android: {
    backgroundColor: "#FFFFFF",
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: "#FFFFFF",
    webContentsDebuggingEnabled: false,
    // The site draws its own header, so let it own the full viewport.
    contentInset: "never",
  },
};

export default config;
