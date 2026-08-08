/**
 * Generates the installable-web-app raster assets from the same lucide "House"
 * mark the navbar uses, so the home-screen icon matches the native app icon.
 *
 *   npm run pwa:assets
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

import { APPLE_SPLASH_DEVICES, appleSplashFileName } from "../lib/apple-splash";

const CREAM = "#FDF8F4";
const TERRA = "#C8705E";
const INTRO_BG = "#140F0D";

const ICONS_DIR = "public/icons";
const SPLASH_DIR = "public/splash";

/** The glyph's inked box is x 2..22, y 1.3..22 once the 2px stroke is counted. */
function houseSvg(size: number, coverage: number) {
  const boxW = 20;
  const boxH = 20.7;
  const scale = (size * coverage) / boxH;
  const tx = (size - boxW * scale) / 2 - 2 * scale;
  const ty = (size - boxH * scale) / 2 - 1.3 * scale;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${CREAM}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})"
     fill="none" stroke="${TERRA}" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
  </g>
</svg>`);
}

async function icon(out: string, size: number, coverage: number) {
  await sharp(houseSvg(size, coverage), { density: 400 })
    .resize(size, size)
    // Home-screen icons are composited on unknown backgrounds; keep them opaque.
    .flatten({ background: CREAM })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(SPLASH_DIR, { recursive: true });

  await icon(`${ICONS_DIR}/favicon-32.png`, 32, 0.72);
  await icon(`${ICONS_DIR}/icon-192.png`, 192, 0.605);
  await icon(`${ICONS_DIR}/icon-512.png`, 512, 0.605);
  // Android crops maskable icons to a circle, so the glyph has to sit in the
  // inner 80% safe zone.
  await icon(`${ICONS_DIR}/icon-maskable-512.png`, 512, 0.42);
  await icon("public/apple-touch-icon.png", 180, 0.605);

  // The launch images are the intro's first frame: a bare dark field that the
  // animation then assembles the house on top of.
  for (const device of APPLE_SPLASH_DEVICES) {
    const width = device.width * device.ratio;
    const height = device.height * device.ratio;

    await sharp({
      create: { width, height, channels: 3, background: INTRO_BG },
    })
      .png({ compressionLevel: 9 })
      .toFile(`${SPLASH_DIR}/${appleSplashFileName(device)}`);
  }

  console.log(`Wrote icons and ${APPLE_SPLASH_DEVICES.length} launch images.`);
}

main();
