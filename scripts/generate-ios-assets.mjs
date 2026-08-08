/**
 * Renders the iOS raster assets from the same lucide "House" mark the web app
 * uses. iOS has no vector app-icon support, so these must be baked as PNGs.
 *
 *   node scripts/generate-ios-assets.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const CREAM = "#FDF8F4";
const TERRA = "#C8705E";
const SPLASH_BG = "#140F0D";

const ICONSET = "ios/App/App/Assets.xcassets/AppIcon.appiconset";
const SPLASHSET = "ios/App/App/Assets.xcassets/Splash.imageset";

/** The glyph's inked box is x 2..22, y 1.3..22 once the 2px stroke is counted. */
function houseSvg(size, { bg, stroke, coverage = 0.605 }) {
  const boxW = 20;
  const boxH = 20.7;
  const scale = (size * coverage) / boxH;
  const tx = (size - boxW * scale) / 2 - 2 * scale;
  const ty = (size - boxH * scale) / 2 - 1.3 * scale;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})"
     fill="none" stroke="${stroke}" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
  </g>
</svg>`);
}

async function png(svg, out, size) {
  // App Store rejects icons with an alpha channel, so flatten every export.
  await sharp(svg, { density: 400 })
    .resize(size, size)
    .flatten({ background: CREAM })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

await mkdir(ICONSET, { recursive: true });
await mkdir(SPLASHSET, { recursive: true });

await png(houseSvg(1024, { bg: CREAM, stroke: TERRA }), `${ICONSET}/AppIcon-512@2x.png`, 1024);

// The launch screen is the first frame of the retro intro, so keep it the bare
// dark field that native/www/splash.html then animates on top of.
const splash = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="${SPLASH_BG}"/></svg>`
);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await sharp(splash).flatten({ background: SPLASH_BG }).png({ compressionLevel: 9 }).toFile(`${SPLASHSET}/${name}`);
}

console.log("iOS assets written.");
