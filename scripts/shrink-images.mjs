// One-time: re-compress base64 photos already stored in the DB so pages that
// embed them inline get lighter. Resizes to a card-friendly max dimension and
// re-encodes as JPEG. Only writes back when the result is actually smaller, so
// it's safe to re-run.
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const MAX_DIM = 800;
const QUALITY = 52;

const prisma = new PrismaClient();
const imgs = await prisma.listingImage.findMany({ select: { id: true, url: true } });

let changed = 0;
let beforeTotal = 0;
let afterTotal = 0;

for (const img of imgs) {
  if (!img.url.startsWith("data:")) continue;
  const comma = img.url.indexOf(",");
  if (comma < 0) continue;

  const inputBytes = Math.floor((img.url.length - comma - 1) * 0.75);
  beforeTotal += inputBytes;

  try {
    const buf = Buffer.from(img.url.slice(comma + 1), "base64");
    const out = await sharp(buf)
      .rotate() // respect EXIF orientation before stripping metadata
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();

    if (out.length < buf.length) {
      const next = `data:image/jpeg;base64,${out.toString("base64")}`;
      await prisma.listingImage.update({ where: { id: img.id }, data: { url: next } });
      changed++;
      afterTotal += out.length;
      console.log(`  shrunk ${img.id}: ${Math.round(buf.length / 1024)}KB -> ${Math.round(out.length / 1024)}KB`);
    } else {
      afterTotal += buf.length;
    }
  } catch (e) {
    afterTotal += inputBytes;
    console.log(`  skipped ${img.id}: ${e.message}`);
  }
}

console.log(
  `\nDone. Re-compressed ${changed} image(s). Base64 payload ${(beforeTotal / 1024 / 1024).toFixed(2)}MB -> ${(afterTotal / 1024 / 1024).toFixed(2)}MB`
);
await prisma.$disconnect();
