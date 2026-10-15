// READ-ONLY verification of the booking -> availability -> Airbnb chain.
// Queries nothing but SELECTs; fetches the live public .ics feed.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ORIGIN = process.env.SWM_ORIGIN || "https://staywithme.co.in";
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const icsDay = (d) => ymd(d).replace(/-/g, "");

function parseFeed(text) {
  const out = [];
  for (const chunk of text.split("BEGIN:VEVENT").slice(1)) {
    const g = (k) => (chunk.match(new RegExp(`^${k}[^:]*:(.+)$`, "m")) || [])[1]?.trim();
    out.push({ uid: g("UID"), start: g("DTSTART"), end: g("DTEND"), summary: g("SUMMARY") });
  }
  return out;
}

(async () => {
  const listings = await prisma.listing.findMany({
    select: { id: true, title: true, icalUrl: true, icalSyncedAt: true, icalError: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== ${listings.length} listing(s) ===`);

  let problems = 0;
  for (const l of listings) {
    console.log(`\n--- ${l.title} (${l.id})`);
    console.log(`    Airbnb -> us  : icalUrl=${l.icalUrl ? "SET" : "NOT SET"}` +
      `  syncedAt=${l.icalSyncedAt ? l.icalSyncedAt.toISOString() : "never"}` +
      `  error=${l.icalError ?? "none"}`);

    const blocks = await prisma.availabilityBlock.findMany({
      where: { listingId: l.id },
      select: { id: true, startDate: true, endDate: true, kind: true },
      orderBy: { startDate: "asc" },
    });
    const bookings = await prisma.booking.findMany({
      where: { listingId: l.id, status: { in: ["CONFIRMED", "AWAITING_APPROVAL"] } },
      select: { id: true, status: true, checkIn: true, checkOut: true, blockId: true },
      orderBy: { checkIn: "asc" },
    });
    const byKind = blocks.reduce((a, b) => ((a[b.kind] = (a[b.kind] || 0) + 1), a), {});
    console.log(`    blocks: ${JSON.stringify(byKind)}   live bookings: ${bookings.length}`);

    // (1) every live booking must own a block
    for (const b of bookings) {
      const blk = b.blockId && blocks.find((x) => x.id === b.blockId);
      const tag = `${b.status} ${ymd(b.checkIn)}->${ymd(b.checkOut)}`;
      if (!blk) { console.log(`    !! ${tag}: NO BLOCK (dates NOT held)`); problems++; }
      else if (ymd(blk.startDate) !== ymd(b.checkIn) || ymd(blk.endDate) !== ymd(b.checkOut)) {
        console.log(`    !! ${tag}: block dates differ (${ymd(blk.startDate)}->${ymd(blk.endDate)})`);
        problems++;
      } else console.log(`    ok ${tag}: block ${blk.id.slice(-6)} kind=${blk.kind}`);
    }

    // (2) cancelled bookings must own no block
    const ghosts = await prisma.booking.findMany({
      where: { listingId: l.id, status: "CANCELLED", blockId: { not: null } },
      select: { id: true, blockId: true, checkIn: true, checkOut: true },
    });
    for (const g of ghosts) {
      const alive = blocks.find((x) => x.id === g.blockId);
      if (alive) {
        console.log(`    !! CANCELLED ${ymd(g.checkIn)}->${ymd(g.checkOut)} STILL BLOCKS dates`);
        problems++;
      }
    }

    // (3) the live public feed Airbnb polls must contain exactly our own blocks
    const url = `${ORIGIN}/api/listings/${l.id}/export.ics`;
    let res;
    try { res = await fetch(url, { cache: "no-store" }); }
    catch (e) { console.log(`    !! feed unreachable: ${e.message}`); problems++; continue; }
    if (!res.ok) { console.log(`    !! feed HTTP ${res.status}`); problems++; continue; }
    const events = parseFeed(await res.text());
    console.log(`    feed: ${url}\n          ${events.length} VEVENT(s)`);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const expected = blocks.filter(
      (b) => ["MANUAL", "BOOKING"].includes(b.kind) && new Date(b.endDate) > today
    );
    for (const b of expected) {
      const hit = events.find((e) => e.uid === `swm-${b.id}@staywithme.co.in`);
      if (!hit) { console.log(`    !! block ${ymd(b.startDate)}->${ymd(b.endDate)} (${b.kind}) MISSING from feed`); problems++; }
      else if (hit.start !== icsDay(b.startDate) || hit.end !== icsDay(b.endDate)) {
        console.log(`    !! feed dates wrong for ${b.id.slice(-6)}: ${hit.start}->${hit.end} vs ${icsDay(b.startDate)}->${icsDay(b.endDate)}`);
        problems++;
      } else console.log(`    ok feed has ${hit.start}->${hit.end} "${hit.summary}"`);
    }
    const leaked = events.filter((e) => !expected.some((b) => `swm-${b.id}@staywithme.co.in` === e.uid));
    for (const e of leaked) { console.log(`    !! feed exports a stale/unknown event ${e.uid} ${e.start}`); problems++; }
  }

  console.log(problems ? `\n######## ${problems} PROBLEM(S) ########` : "\n######## CHAIN VERIFIED — no problems ########");
  await prisma.$disconnect();
  process.exit(problems ? 1 : 0);
})();
