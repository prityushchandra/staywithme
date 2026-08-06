import { Font } from "@react-pdf/renderer";

// Noto Sans includes the ₹ (U+20B9) glyph that @react-pdf's built-in fonts lack.
// Registered once; @react-pdf caches the fetched font files for the process.
const REGULAR =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const BOLD =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";

export const RECEIPT_FONT = "NotoSans";

let registered = false;

export function registerReceiptFonts() {
  if (registered) return;
  Font.register({
    family: RECEIPT_FONT,
    fonts: [
      { src: REGULAR, fontWeight: "normal" },
      { src: BOLD, fontWeight: "bold" },
    ],
  });
  // Keep long words / URLs from being hyphen-split mid-word.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
