// Fonts for receipt images. next/og's built-in font lacks the ₹ (U+20B9) glyph,
// so amounts render as "tofu". Noto Sans includes ₹, so we load it (regular +
// bold), cache the bytes for the lifetime of the server process, and fall back
// to [] on any failure so a receipt still renders even if the CDN is unreachable.

type ReceiptFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

const SOURCES: { url: string; weight: 400 | 700 }[] = [
  { url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf", weight: 400 },
  { url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf", weight: 700 },
];

let cache: ReceiptFont[] | null = null;
let pending: Promise<ReceiptFont[]> | null = null;

export async function getReceiptFonts(): Promise<ReceiptFont[]> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    try {
      const fonts = await Promise.all(
        SOURCES.map(async (s) => {
          const res = await fetch(s.url);
          if (!res.ok) throw new Error(`font ${s.weight} → ${res.status}`);
          return {
            name: "Noto Sans",
            data: await res.arrayBuffer(),
            weight: s.weight,
            style: "normal" as const,
          };
        })
      );
      cache = fonts;
      return fonts;
    } catch (e) {
      console.error("[receipt-fonts] load failed:", (e as Error).message);
      return [];
    } finally {
      pending = null;
    }
  })();
  return pending;
}
