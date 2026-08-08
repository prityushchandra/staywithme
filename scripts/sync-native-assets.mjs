/**
 * The Capacitor shells need the intro to play from the app bundle, before any
 * network request finishes, so `public/intro.js` is mirrored into the webDir.
 * `public/` stays the single source of truth.
 *
 *   node scripts/sync-native-assets.mjs
 */
import { copyFile } from "node:fs/promises";

const ASSETS = [["public/intro.js", "native/www/intro.js"]];

for (const [from, to] of ASSETS) {
  await copyFile(from, to);
  console.log(`${from} -> ${to}`);
}
