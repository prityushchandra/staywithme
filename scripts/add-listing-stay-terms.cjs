const assert = require("node:assert/strict");
const path = require("node:path");

const fields = ["minimumNights", "monthlyStayDiscount"];
const sql = `ALTER TABLE public."Listing"
  ADD COLUMN IF NOT EXISTS "minimumNights" INTEGER,
  ADD COLUMN IF NOT EXISTS "monthlyStayDiscount" INTEGER`;
const preservedTables = [
  "Listing", "ListingImage", "Review", "Booking", "OfflineBooking", "AvailabilityBlock", "Receipt",
];

async function snapshot(tx, newFields) {
  const result = [];
  for (const table of preservedTables) {
    const rowJson = table === "Listing" && newFields.length
      ? `to_jsonb(row) - ARRAY[${newFields.map((field) => `'${field}'`).join(",")}]::text[]`
      : "to_jsonb(row)";
    const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(md5((${rowJson})::text), '' ORDER BY "id"), '')) AS fingerprint
      FROM public."${table}" row`);
    result.push({ table, ...row });
  }
  return result;
}

async function apply() {
  require("@next/env").loadEnvConfig(path.resolve(__dirname, ".."));
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required for the schema migration");
  const { PrismaClient, Prisma } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const readColumns = (tx) => tx.$queryRawUnsafe(`SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Listing'
      AND column_name IN ('minimumNights', 'monthlyStayDiscount')
    ORDER BY column_name`);

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await tx.$executeRawUnsafe('LOCK TABLE public."Listing" IN ACCESS EXCLUSIVE MODE');
      const existing = await readColumns(tx);
      const newFields = fields.filter((field) => !existing.some((column) => column.column_name === field));
      const before = await snapshot(tx, newFields);
      await tx.$executeRawUnsafe(sql);
      assert.deepEqual(await readColumns(tx), fields.map((column_name) => ({
        column_name, data_type: "integer", is_nullable: "YES",
      })), "Stay terms must be nullable integer columns");
      for (const field of newFields) {
        const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count
          FROM public."Listing" WHERE "${field}" IS NOT NULL`);
        assert.equal(row.count, 0, "Existing listings must keep their current booking terms");
      }
      assert.deepEqual(await snapshot(tx, newFields), before, "Existing data must remain unchanged");
      return { added: newFields, preserved: before.map(({ table, count }) => ({ table, count })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
    console.log("Stay terms applied; existing data fingerprints unchanged:", JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

console.log("Reviewed additive stay terms schema:\n" + sql + ";");
if (process.argv.includes("--apply")) {
  apply().catch((error) => { console.error(error.message); process.exitCode = 1; });
} else {
  console.log("Review only. Nothing connected or changed. Add --apply for the coordinated release.");
}
