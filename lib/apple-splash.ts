/**
 * iOS only shows a launch image when a `apple-touch-startup-image` link matches
 * the device's CSS size *and* pixel ratio exactly, so every supported iPhone
 * needs its own file. Without these the installed app flashes white while the
 * page loads instead of sitting on the intro's dark field.
 *
 * Shared by the layout metadata and scripts/generate-pwa-assets.ts so the files
 * and the link tags can't drift apart.
 */
export const APPLE_SPLASH_DEVICES = [
  { width: 320, height: 568, ratio: 2 }, // SE (1st gen)
  { width: 375, height: 667, ratio: 2 }, // SE (2nd/3rd gen), 8
  { width: 414, height: 736, ratio: 3 }, // 8 Plus
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12/13 mini
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14
  { width: 428, height: 926, ratio: 3 }, // 12/13 Pro Max, 14 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 16
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { width: 402, height: 874, ratio: 3 }, // 16 Pro
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max
] as const;

export function appleSplashFileName(device: { width: number; height: number; ratio: number }) {
  return `apple-splash-${device.width * device.ratio}x${device.height * device.ratio}.png`;
}

export function appleSplashLinks() {
  return APPLE_SPLASH_DEVICES.map((device) => ({
    url: `/splash/${appleSplashFileName(device)}`,
    media:
      `(device-width: ${device.width}px) and (device-height: ${device.height}px) ` +
      `and (-webkit-device-pixel-ratio: ${device.ratio}) and (orientation: portrait)`,
  }));
}
