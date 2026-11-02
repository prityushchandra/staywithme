const assert = require("node:assert/strict");
const path = require("node:path");

// Review-only by default: no environment loading, DB connection, or writes.
// Run with --apply only during the coordinated release, before the new app.
const createTable = `CREATE TABLE IF NOT EXISTS public."ListingVisibilityMonth" (
  "listingId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "isVisible" BOOLEAN NOT NULL,
  CONSTRAINT "ListingVisibilityMonth_pkey" PRIMARY KEY ("listingId", "month"),
  CONSTRAINT "ListingVisibilityMonth_month_check"
    CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "ListingVisibilityMonth_listingId_fkey" FOREIGN KEY ("listingId")
    REFERENCES public."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

// Do not infer past visibility from updatedAt, or replace already tracked months.
// CURRENT_TIMESTAMP is fixed for the transaction and matches currentPnlMonth.
const backfill = `INSERT INTO public."ListingVisibilityMonth" ("listingId", "month", "isVisible")
SELECT l."id",
  to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'),
  (l."status" = 'PUBLISHED' AND l."isVisible")
FROM public."Listing" l
WHERE NOT EXISTS (
  SELECT 1 FROM public."ListingVisibilityMonth" h WHERE h."listingId" = l."id"
)
ON CONFLICT ("listingId", "month") DO NOTHING`;

const preservedTables = [
  "Listing", "Booking", "OfflineBooking", "AvailabilityBlock", "Receipt",
  "OnlineEarning", "Staff", "StaffMonth", "StaffPayroll", "ListingDotMonth", "Expense",
];

async function snapshot(tx) {
  const out = [];
  for (const table of preservedTables) {
    const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(md5(to_jsonb(row)::text), '' ORDER BY "id"), '')) AS fingerprint
      FROM public."${table}" row`);
    out.push({ table, ...row });
  }
  return out;
}

async function apply() {
  const repo = path.resolve(__dirname, "..");
  require("@next/env").loadEnvConfig(repo);
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required for the schema migration");
  const { PrismaClient, Prisma } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await tx.$executeRawUnsafe('LOCK TABLE public."Listing" IN SHARE MODE');
      const before = await snapshot(tx);
      await tx.$executeRawUnsafe(createTable);
      const columns = await tx.$queryRawUnsafe(`SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ListingVisibilityMonth'
        ORDER BY ordinal_position`);
      assert.deepEqual(columns, [
        { column_name: "listingId", data_type: "text", is_nullable: "NO" },
        { column_name: "month", data_type: "text", is_nullable: "NO" },
        { column_name: "isVisible", data_type: "boolean", is_nullable: "NO" },
      ], "Monthly visibility table must match the reviewed schema");
      const previous = await tx.$queryRawUnsafe(
        'SELECT "listingId", "month", "isVisible" FROM public."ListingVisibilityMonth" ORDER BY "listingId", "month"'
      );
      const inserted = await tx.$executeRawUnsafe(backfill);
      const after = await snapshot(tx);
      assert.deepEqual(after, before, "Existing listing, financial and calendar rows must remain unchanged");
      const history = await tx.$queryRawUnsafe(
        'SELECT "listingId", "month", "isVisible" FROM public."ListingVisibilityMonth" ORDER BY "listingId", "month"'
      );
      const oldKeys = new Set(previous.map((row) => `${row.listingId}|${row.month}`));
      assert.deepEqual(
        history.filter((row) => oldKeys.has(`${row.listingId}|${row.month}`)),
        previous,
        "Existing monthly visibility history must remain unchanged"
      );
      const [check] = await tx.$queryRawUnsafe(`SELECT
        to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
        count(*)::int AS missing
        FROM public."Listing" l
        WHERE NOT EXISTS (
          SELECT 1 FROM public."ListingVisibilityMonth" h WHERE h."listingId" = l."id"
        )`);
      assert.equal(check.missing, 0, "Every existing listing must have a monthly baseline");
      const newRows = history.filter((row) => !oldKeys.has(`${row.listingId}|${row.month}`));
      assert.equal(newRows.length, inserted);
      assert.ok(newRows.every((row) => row.month === check.month), "Backfill must affect this month only");
      return {
        month: check.month,
        inserted,
        preserved: before.map(({ table, count }) => ({ table, count })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
    console.log("Monthly visibility baseline applied; original data fingerprints unchanged:", JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

console.log("Reviewed additive schema + current-month visibility baseline:\n" + [createTable, backfill].join(";\n") + ";");
if (process.argv.includes("--apply")) {
  apply().catch((error) => { console.error(error.message); process.exitCode = 1; });
} else {
  console.log("Review only. Nothing connected or changed. Add --apply for the coordinated release.");
}
