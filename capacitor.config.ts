import type { CapacitorConfig } from "@capacitor/cli";

/**
 * StayWithMe is fully server-rendered (Prisma, NextAuth, API routes), so the
 * Android shell loads the live site instead of bundling a static export.
 * `native/www` only ships the offline fallback page referenced by errorPath.
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
};

export default config;
