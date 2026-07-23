// TEMPORARY one-time data migration: Neon (source) -> Supabase (target).
// Run probe:   node --env-file=.env scripts/_migrate-neon-to-supabase.mjs
// Run migrate: node --env-file=.env scripts/_migrate-neon-to-supabase.mjs --run
// Safe to re-run: uses createMany({ skipDuplicates: true }) keyed on primary keys.
import { PrismaClient } from "@prisma/client";

const rawNeon = process.env.NEON_DATABASE_URL;
const supaUrl = process.env.DIRECT_URL; // Supabase session pooler (robust for bulk writes)

if (!rawNeon) { console.error("NEON_DATABASE_URL missing"); process.exit(1); }
if (!supaUrl) { console.error("DIRECT_URL missing"); process.exit(1); }

// Disable prepared statements against Neon's PgBouncer pooler.
const neonUrl = rawNeon.includes("pgbouncer=") ? rawNeon : rawNeon + "&pgbouncer=true";

const neon = new PrismaClient({ datasourceUrl: neonUrl });
const supa = new PrismaClient({ datasourceUrl: supaUrl });

// Parents before children so foreign keys always resolve.
const ORDER = [
  "user", "amenity", "block", "platformSettings", "cancellationPolicyText",
  "verificationToken", "otpCode", "whatsAppLogin", "botConversation", "analyticsEvent",
  "account", "session", "listing", "listingImage", "listingAmenity",
  "availabilityBlock", "wishlist", "wishlistItem", "review", "booking",
];

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const RUN = process.argv.includes("--run");

async function counts(client) {
  const c = {};
  for (const m of ORDER) c[m] = await client[m].count();
  return c;
}

async function main() {
  console.log("Phase 1: Neon (source) inventory");
  const src = await counts(neon);
  console.table(src);
  const srcTotal = Object.values(src).reduce((a, b) => a + b, 0);
  console.log("Source total rows:", srcTotal);

  if (!RUN) {
    console.log("\nProbe only (pass --run to migrate). Supabase current counts:");
    console.table(await counts(supa));
    return;
  }

  console.log("\nPhase 2: copying Neon -> Supabase");
  const summary = [];
  for (const m of ORDER) {
    const rows = await neon[m].findMany();
    let inserted = 0;
    for (const c of chunk(rows, 500)) {
      const res = await supa[m].createMany({ data: c, skipDuplicates: true });
      inserted += res.count;
    }
    const target = await supa[m].count();
    summary.push({ model: m, source: rows.length, inserted, target });
    console.log(`  ${m.padEnd(24)} source=${rows.length}  inserted=${inserted}  target=${target}`);
  }

  console.log("\nPhase 3: verification (source vs target)");
  console.table(summary);
  const mism = summary.filter((s) => s.source !== s.target);
  if (mism.length) { console.log("MISMATCHES:", JSON.stringify(mism)); process.exitCode = 2; }
  else console.log("All tables match.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await neon.$disconnect(); await supa.$disconnect(); });
