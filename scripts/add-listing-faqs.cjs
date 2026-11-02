const assert = require("node:assert/strict");
const path = require("node:path");

const sql = `CREATE TABLE IF NOT EXISTS public."ListingFaq" (
  "listingId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  CONSTRAINT "ListingFaq_pkey" PRIMARY KEY ("listingId", "position"),
  CONSTRAINT "ListingFaq_listingId_fkey" FOREIGN KEY ("listingId")
    REFERENCES public."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;
const preservedTables = [
  "Listing", "ListingImage", "Review", "Booking", "OfflineBooking", "AvailabilityBlock", "Receipt",
];

async function snapshot(tx) {
  const result = [];
  for (const table of preservedTables) {
    const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(md5(to_jsonb(row)::text), '' ORDER BY "id"), '')) AS fingerprint
      FROM public."${table}" row`);
    result.push({ table, ...row });
  }
  return result;
}

async function faqSnapshot(tx) {
  const [row] = await tx.$queryRawUnsafe(`SELECT
    count(*)::int AS count,
    md5(COALESCE(string_agg(md5(to_jsonb(row)::text), '' ORDER BY "listingId", "position"), '')) AS fingerprint
    FROM public."ListingFaq" row`);
  return row;
}

async function apply() {
  require("@next/env").loadEnvConfig(path.resolve(__dirname, ".."));
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required for the schema migration");
  const { PrismaClient, Prisma } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await tx.$executeRawUnsafe('LOCK TABLE public."Listing" IN SHARE MODE');
      const [existing] = await tx.$queryRawUnsafe(`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ListingFaq'
      ) AS present`);
      const before = await snapshot(tx);
      const previousFaqs = existing.present ? await faqSnapshot(tx) : null;
      await tx.$executeRawUnsafe(sql);
      const columns = await tx.$queryRawUnsafe(`SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ListingFaq'
        ORDER BY ordinal_position`);
      assert.deepEqual(columns, [
        { column_name: "listingId", data_type: "text", is_nullable: "NO" },
        { column_name: "position", data_type: "integer", is_nullable: "NO" },
        { column_name: "question", data_type: "text", is_nullable: "NO" },
        { column_name: "answer", data_type: "text", is_nullable: "NO" },
      ], "The FAQ table must match the reviewed schema");
      assert.deepEqual(await snapshot(tx), before, "Existing listing and booking data must remain unchanged");
      if (previousFaqs) {
        assert.deepEqual(await faqSnapshot(tx), previousFaqs, "Existing FAQs must remain unchanged");
      } else {
        assert.equal((await faqSnapshot(tx)).count, 0, "Existing listings must start without invented FAQs");
      }
      return {
        alreadyPresent: existing.present,
        preserved: before.map(({ table, count }) => ({ table, count })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
    console.log("FAQ table applied; original data fingerprints unchanged:", JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

console.log("Reviewed additive FAQ schema:\n" + sql + ";");
if (process.argv.includes("--apply")) {
  apply().catch((error) => { console.error(error.message); process.exitCode = 1; });
} else {
  console.log("Review only. Nothing connected or changed. Add --apply for the coordinated release.");
}
