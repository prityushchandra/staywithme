import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import type { PlatformSettings } from "@prisma/client";

const DEFAULTS = {
  id: "singleton",
  whatsappNumber: "+918789194107",
  platformFeePercent: 10,
  suggestedPriceMin: 220000,
  suggestedPriceMax: 250000,
};

async function readPlatformSettings(): Promise<PlatformSettings> {
  const existing = await prisma.platformSettings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) return existing;

  return prisma.platformSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: DEFAULTS,
  });
}

// Tagged with "settings" so the admin save (revalidateTag("settings")) busts it
// across EVERY page — including statically-rendered ones like the navbar/sign-in
// — not just the request that happened to be warm. revalidate is a safety net.
const getCachedSettings = unstable_cache(readPlatformSettings, ["platform-settings"], {
  tags: ["settings"],
  revalidate: 60,
});

/**
 * Read the single PlatformSettings row, creating it with defaults if missing.
 * This is the ONLY home for the WhatsApp number, platform fee, suggested price
 * range, and branding toggles. Hosts have no access; only admin endpoints update
 * it. The admin settings route calls revalidateTag("settings") on save.
 */
export function getPlatformSettings(): Promise<PlatformSettings> {
  return getCachedSettings();
}
