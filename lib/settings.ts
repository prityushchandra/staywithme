import { prisma } from "./db";
import { memo } from "./memo";
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

/**
 * Read the single PlatformSettings row, creating it with defaults if missing.
 * This is the ONLY home for the WhatsApp number, platform fee, and suggested
 * price range. Hosts have no access; only admin endpoints may update it.
 *
 * Cached across requests (settings change rarely and only via admin); the admin
 * settings route calls revalidateTag("settings") on save. This spares every page
 * a round-trip to the remote database.
 */
export function getPlatformSettings(): Promise<PlatformSettings> {
  return memo("platform-settings", 60_000, readPlatformSettings);
}
