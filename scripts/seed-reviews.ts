// Seed realistic synthetic reviews for every PUBLISHED listing.
//
//   npm run db:seed-reviews              # idempotent seed (skips listings already seeded)
//   npm run db:seed-reviews -- --force   # rebuild the synthetic reviews from scratch
//   npm run db:seed-reviews -- --verify  # just print the per-listing report
//   npm run db:seed-reviews -- --dry-run # plan only, writes nothing
//   npm run db:seed-reviews -- --reset   # delete ONLY the synthetic reviews + users
//
// This runs against the PRODUCTION database. Every write and delete here is
// scoped by SYNTHETIC_EMAIL_DOMAIN: synthetic guests are the only rows this
// script will ever create, update or remove. Real users (phone-identity, no
// email) and their data are never touched.
//
// Synthetic guests are inert by construction:
//   - phone = null         → the phone-OTP and WhatsApp providers can't find them
//   - passwordHash = null  → no credentials login
//   - suspended = true     → every provider rejects them even if one were found
//   - email on the reserved .invalid TLD (RFC 2606) → no real mailbox, and no
//     Google account can ever exist to link against it

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The marker that makes synthetic data identifiable — and safely deletable. */
const SYNTHETIC_EMAIL_DOMAIN = "seed-reviews.invalid";
const SYNTHETIC_EMAIL_SUFFIX = `@${SYNTHETIC_EMAIL_DOMAIN}`;

/** How many synthetic guests to keep in the pool. Must exceed MAX_REVIEWS. */
const USER_POOL_SIZE = 150;

/** Review count per listing is drawn from this inclusive range. */
const MIN_REVIEWS = 78;
const MAX_REVIEWS = 100;

/** The average every listing must land on, to 2 decimal places. */
const TARGET_AVERAGE = 4.97;

/** Reviews are backdated across roughly the last 18 months. */
const SPREAD_DAYS = 548;
/** >1 biases timestamps towards the present, so recent months are denser. */
const RECENCY_BIAS = 1.7;

/** The host, as guests refer to him. */
const HOST_NAME = "Mr. Chandra";
const HOST_FIRST_NAME = "Chandra";

/**
 * Real reviews are one or two lines. Bodies are held to that: most land well
 * under the cap, and a healthy share are true one-liners.
 */
const MAX_BODY_LENGTH = 170;
const SHORT_BODY_LENGTH = 70;
const MIN_SHORT_SHARE = 0.28;

// ---------------------------------------------------------------------------
// Deterministic RNG — the same listing always produces the same plan
// ---------------------------------------------------------------------------

function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for seed data. */
function makeRng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Rating mix — Review.rating is an Int, so 4.97 has to come out of the mix
// ---------------------------------------------------------------------------

/**
 * How many 4s are needed among `count` reviews (rest are 5s) for the mean to
 * round to TARGET_AVERAGE. Returns null when no integer mix can hit it, and
 * never returns a count whose mean sits exactly on a rounding boundary.
 */
function foursNeeded(count: number): number | null {
  const candidates: number[] = [];
  for (let fours = 0; fours <= count; fours++) {
    const mean = (5 * count - fours) / count;
    if (round2(mean) !== TARGET_AVERAGE) continue;
    // Reject means sitting on the x.xx5 boundary — their rounding is not stable
    // across languages/engines, and a report elsewhere could print 4.98.
    const scaled = mean * 1000;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 && Math.round(scaled) % 10 === 5) continue;
    candidates.push(fours);
  }
  if (candidates.length === 0) return null;
  // Prefer the mix closest to a true 4.97 (3% of reviews are 4s).
  const ideal = count * 0.03;
  return candidates.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
}

/** Review counts in [MIN_REVIEWS, MAX_REVIEWS] that can actually average 4.97. */
const VALID_COUNTS = Array.from(
  { length: MAX_REVIEWS - MIN_REVIEWS + 1 },
  (_, i) => MIN_REVIEWS + i
).filter((n) => foursNeeded(n) !== null);

if (VALID_COUNTS.length === 0) {
  throw new Error(
    `No review count in [${MIN_REVIEWS}, ${MAX_REVIEWS}] can average ${TARGET_AVERAGE} with 4s and 5s`
  );
}

// ---------------------------------------------------------------------------
// Synthetic guests
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Aarav", "Aditi", "Akash", "Ananya", "Anirudh", "Anjali", "Arjun", "Ashwin",
  "Bhavana", "Chaitanya", "Deepak", "Devika", "Dhruv", "Divya", "Farhan",
  "Gaurav", "Gayathri", "Harsha", "Hemant", "Ishaan", "Ishita", "Jayanth",
  "Karthik", "Kavya", "Keerthi", "Kunal", "Lakshmi", "Madhav", "Mahesh",
  "Manasa", "Meghana", "Mithun", "Mohit", "Naveen", "Neha", "Nikhil", "Nithya",
  "Pallavi", "Pranav", "Prateek", "Preethi", "Rahul", "Rakesh", "Ramya",
  "Rashmi", "Rohan", "Rohit", "Sagar", "Sandeep", "Sanjana", "Shalini",
  "Shreya", "Siddharth", "Smriti", "Sneha", "Sohail", "Sridhar", "Sruthi",
  "Sunil", "Swathi", "Tanvi", "Tarun", "Ujjwal", "Vaishnavi", "Varun", "Vidya",
  "Vikram", "Vinay", "Vivek", "Yashwanth", "Zoya", "Imran", "Nandini", "Ritu",
  "Abhishek", "Shruti", "Pooja", "Kiran", "Lavanya", "Rajesh",
] as const;

const LAST_NAMES = [
  "Agarwal", "Ahuja", "Bhat", "Bhattacharya", "Chandran", "Chatterjee",
  "Deshpande", "Dixit", "Gowda", "Gupta", "Hegde", "Iyer", "Iyengar", "Jain",
  "Joshi", "Kamath", "Kaur", "Khan", "Kulkarni", "Kumar", "Malhotra", "Menon",
  "Mishra", "Nadkarni", "Nair", "Nayak", "Pai", "Patel", "Pillai", "Prasad",
  "Raghavan", "Rao", "Reddy", "Saxena", "Sen", "Shetty", "Singh", "Sinha",
  "Srinivasan", "Subramanian", "Thomas", "Varma", "Venkatesh", "Verma",
  "Shenoy", "Kashyap", "Bansal", "Dutta", "Ghosh", "Mathew",
] as const;

interface SyntheticGuest {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
}

/** A stable, deterministic pool of guests with distinct names and emails. */
function buildGuestPool(): SyntheticGuest[] {
  const rng = makeRng("staywithme:synthetic-guest-pool:v1");
  const guests: SyntheticGuest[] = [];
  const usedNames = new Set<string>();

  let guard = 0;
  while (guests.length < USER_POOL_SIZE && guard++ < USER_POOL_SIZE * 200) {
    const firstName = pick(rng, FIRST_NAMES);
    const lastName = pick(rng, LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const index = String(guests.length + 1).padStart(3, "0");
    guests.push({
      email: `guest-${index}${SYNTHETIC_EMAIL_SUFFIX}`,
      name,
      firstName,
      lastName,
    });
  }

  if (guests.length < USER_POOL_SIZE) {
    throw new Error(`Could only build ${guests.length}/${USER_POOL_SIZE} distinct guest names`);
  }
  return guests;
}

// ---------------------------------------------------------------------------
// Review copy — short, plain-English lines for a serviced flat inside a
// Bengaluru residential society. One or two sentences, never a paragraph.
// ---------------------------------------------------------------------------

/**
 * How a review refers to the host, and how often. Half of all bodies name no
 * host at all — naming him in most of them was the giveaway.
 */
const HOST_BUCKETS = [
  { key: "full", token: HOST_NAME, weight: 15 },
  { key: "first", token: HOST_FIRST_NAME, weight: 15 },
  { key: "generic", token: "the host", weight: 20 },
  { key: "none", token: null, weight: 50 },
] as const;

type HostBucket = (typeof HOST_BUCKETS)[number]["key"];

const HOST_BUCKET_WEIGHT = HOST_BUCKETS.reduce((a, b) => a + b.weight, 0);

function pickHostBucket(rng: () => number): (typeof HOST_BUCKETS)[number] {
  let roll = rng() * HOST_BUCKET_WEIGHT;
  for (const bucket of HOST_BUCKETS) {
    roll -= bucket.weight;
    if (roll <= 0) return bucket;
  }
  return HOST_BUCKETS[HOST_BUCKETS.length - 1];
}

/** `{H}` reads correctly as "Mr. Chandra", "Chandra" or "the host". */
const HOST_LINES_ANY = [
  "{H} replied within minutes.",
  "{H} was quick on WhatsApp.",
  "{H} sorted the gate pass in advance.",
  "{H} arranged a late check-in, no fuss.",
  "{H} had the AC on before we reached.",
  "{H} answered everything before we had to ask.",
  "{H} fixed the geyser the same evening.",
  "{H} was easy to deal with.",
  "{H} followed up after checkout.",
  "{H} sent directions with photos of the building.",
  "{H} let us check out two hours late.",
  "{H} clearly looks after the place personally.",
  "{H} warned us about a water cut so we filled up in time.",
  "{H} was polite and quick with everything.",
  "Coordination with {H} was effortless.",
  "Zero hassle with {H}.",
  "Communication from {H} was prompt.",
  "{H} suggested two places to eat nearby, both good calls.",
  "{H} found us an extra mattress at short notice.",
  "{H} made the whole thing painless.",
  "{H} checked in once and otherwise left us alone, which is just right.",
  "Extending by a night was one message to {H}.",
] as const;

/** Only used when the bucket carries an actual name. */
const HOST_LINES_NAMED = [
  "Thanks {H} for the easy check-in.",
  "Special mention to {H} for sorting our 1am arrival.",
  "{H}, thanks for the quick replies.",
  "Hats off to {H}.",
  "{H} is a proper host, not a side hustle.",
] as const;

/** Only used by the generic bucket. */
const HOST_LINES_GENERIC = [
  "Host was lovely to deal with.",
  "Host responds fast.",
  "No complaints with the host at all.",
  "Host had everything ready and waiting.",
  "Host knows what he is doing.",
] as const;

/** Stacked into fragment one-liners like "Clean, quiet and well located." */
const ADJECTIVES = [
  "clean",
  "quiet",
  "comfortable",
  "well located",
  "spotless",
  "well maintained",
  "exactly as pictured",
  "easy to find",
  "safe",
  "bright",
  "great value",
  "hassle-free",
  "well stocked",
  "freshly cleaned",
  "convenient",
  "tidy",
  "peaceful",
  "as advertised",
  "well equipped",
  "comfy",
] as const;

interface Line {
  text: string;
  tag: string;
}

const LINES: Line[] = [
  { tag: "clean", text: "Spotless when we walked in." },
  { tag: "clean", text: "Fresh linen, clean bathroom, nothing to flag." },
  { tag: "clean", text: "Properly clean, right down to the fridge." },
  { tag: "clean", text: "Housekeeping had clearly done a thorough job." },
  { tag: "clean", text: "Cleaner than most hotels I have stayed in." },
  { tag: "clean", text: "Towels and linen were fresh." },
  { tag: "clean", text: "No dust, no damp smell, nothing." },
  { tag: "clean", text: "Bathroom was sparkling." },

  { tag: "checkin", text: "Check-in took five minutes." },
  { tag: "checkin", text: "Self check-in was seamless." },
  { tag: "checkin", text: "Landed at 1am and got in without a single call." },
  { tag: "checkin", text: "Instructions came the night before, with photos." },
  { tag: "checkin", text: "Early check-in was no problem at all." },
  { tag: "checkin", text: "Keys were with security exactly as promised." },
  { tag: "checkin", text: "Checkout was just as easy." },

  { tag: "society", text: "Gated society, guards at the gate, felt safe throughout." },
  { tag: "society", text: "Society is well kept and genuinely quiet." },
  { tag: "society", text: "Lift was quick and the common areas were clean." },
  { tag: "society", text: "Security sorted the gate pass in under a minute." },
  { tag: "society", text: "Quiet at night, which I honestly did not expect." },
  { tag: "society", text: "Power cut once and the backup caught it instantly." },
  { tag: "society", text: "Parking sorted the moment we gave the flat number." },
  { tag: "society", text: "Guards were polite and sent deliveries straight up." },

  { tag: "flat", text: "AC cooled the room fast and ran quietly." },
  { tag: "flat", text: "Wifi held up through back-to-back calls." },
  { tag: "flat", text: "The bed is genuinely comfortable." },
  { tag: "flat", text: "Kitchen had the basics - kettle, induction, some spices." },
  { tag: "flat", text: "Washing machine was a lifesaver on a long stay." },
  { tag: "flat", text: "Good water pressure for a high floor." },
  { tag: "flat", text: "Hot water was instant every morning." },
  { tag: "flat", text: "Balcony view in the evening is lovely." },
  { tag: "flat", text: "High floor, good light, no street noise." },
  { tag: "flat", text: "Plenty of plug points by the bed and the desk." },
  { tag: "flat", text: "Compact, but everything you actually need is there." },
  { tag: "flat", text: "Enough storage to properly unpack." },
  { tag: "flat", text: "Fittings are new and everything worked." },

  { tag: "location", text: "Cabs are easy at any hour." },
  { tag: "location", text: "Supermarket and a decent coffee place within walking distance." },
  { tag: "location", text: "Food delivery reached in fifteen minutes." },
  { tag: "location", text: "Close enough to the metro to make everything easy." },
  { tag: "location", text: "Handy for an early airport run." },
  { tag: "location", text: "Offices on one side, food on the other." },
  { tag: "location", text: "Plenty of dinner options within five minutes." },

  { tag: "value", text: "Great value for this part of Bengaluru." },
  { tag: "value", text: "Cheaper and better than the service apartments nearby." },
  { tag: "value", text: "Fair price for what you get." },
  { tag: "value", text: "Worked out far cheaper than a hotel for the week." },

  { tag: "overall", text: "Exactly as pictured." },
  { tag: "overall", text: "No surprises, which is rare." },
  { tag: "overall", text: "Did exactly what we needed." },
  { tag: "overall", text: "Would book again." },
  { tag: "overall", text: "Would happily stay again." },
  { tag: "overall", text: "Recommended." },
  { tag: "overall", text: "This will be my default in the city." },
  { tag: "overall", text: "Already booked it again for next month." },
  { tag: "overall", text: "Second stay here, same experience." },
  { tag: "overall", text: "Four nights, zero issues." },
  { tag: "overall", text: "Perfect for a short work trip." },
  { tag: "overall", text: "My parents stayed five nights and loved it." },
  { tag: "overall", text: "Nothing to complain about." },
  { tag: "overall", text: "Easy, uncomplicated stay." },
  { tag: "overall", text: "Honestly better than I expected." },
  { tag: "overall", text: "Solid place at a fair price." },
  { tag: "overall", text: "Three weeks here and never thought about moving." },
  { tag: "overall", text: "Would recommend to anyone here for work." },
];

/** One mild, specific gripe. Every 4-star body carries exactly one. */
const NIGGLES = [
  "Wifi dropped once.",
  "Lift is slow at peak hours.",
  "Bit of street noise in the morning.",
  "Shower pressure could be better.",
  "Only one set of towels for a longer stay.",
  "Kitchen is basic if you actually want to cook.",
  "Took a while to work out the induction hob.",
  "Parking is tight on weekends.",
  "Could do with a bedside lamp.",
  "Autos at the gate take patience at peak hour.",
  "Bedroom AC was a little noisy.",
  "Gate entry took longer than it should have.",
  "Housekeeping missed the balcony.",
  "No blackout curtains, so mornings are bright.",
  "Service lift one morning while the main one was serviced.",
  "Wardrobe space is tight for two people.",
] as const;

/** Measured sign-offs for 4-star bodies, so they never read like a 5. */
const CLOSERS_FOUR = [
  "Still good value.",
  "Nothing major.",
  "Would still recommend.",
  "Otherwise all good.",
  "Minor, but worth knowing.",
  "Did not spoil the stay.",
  "Happy enough overall.",
] as const;

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hostLine(rng: () => number, bucket: (typeof HOST_BUCKETS)[number]): string {
  if (bucket.token === null) throw new Error("hostLine called for the no-host bucket");
  const named = bucket.key !== "generic";
  const pool: string[] = [
    ...HOST_LINES_ANY,
    ...(named ? HOST_LINES_NAMED : HOST_LINES_GENERIC),
  ];
  const template = pick(rng, pool);
  return capitalise(template.replaceAll("{H}", bucket.token));
}

/** A content sentence: either a stack of adjectives or a line from the pool. */
function contentLine(rng: () => number, usedTags: Set<string>): Line {
  const roll = rng();
  // Only one adjective stack per body — two in a row reads like a word salad.
  if (!usedTags.has("adj")) {
    if (roll < 0.26) {
      const [a, b, c] = shuffled(rng, ADJECTIVES);
      return { tag: "adj", text: `${capitalise(a)}, ${b} and ${c}.` };
    }
    if (roll < 0.38) {
      const [a, b] = shuffled(rng, ADJECTIVES);
      return { tag: "adj", text: `${capitalise(a)} and ${b}.` };
    }
  }
  const available = LINES.filter((l) => !usedTags.has(l.tag));
  return pick(rng, available.length > 0 ? available : LINES);
}

/**
 * Real reviews are not uniformly tidy. A few drop the full stop or run
 * lowercase, which is how people actually type on a phone.
 */
function humanise(rng: () => number, body: string, bucket: HostBucket): string {
  let out = body;
  if (bucket === "none" && out.length <= SHORT_BODY_LENGTH && rng() < 0.06) {
    out = out.toLowerCase();
  }
  if (rng() < 0.08 && out.endsWith(".")) out = out.slice(0, -1);
  return out;
}

function composeBody(rng: () => number, rating: number): { body: string; bucket: HostBucket } {
  const bucket = pickHostBucket(rng);
  const usedTags = new Set<string>();
  const parts: string[] = [];

  const addContent = () => {
    const line = contentLine(rng, usedTags);
    usedTags.add(line.tag);
    parts.push(line.text);
  };

  if (rating === 4) {
    // Always exactly one gripe, nearly always balanced by something positive.
    const niggle = pick(rng, NIGGLES);
    if (bucket.token !== null) {
      const host = hostLine(rng, bucket);
      if (rng() < 0.5) parts.push(host, niggle);
      else parts.push(niggle, host);
    } else {
      const roll = rng();
      if (roll < 0.22) parts.push(niggle);
      else if (roll < 0.76) {
        addContent();
        parts.push(niggle);
      } else {
        parts.push(niggle, pick(rng, CLOSERS_FOUR));
      }
    }
  } else if (bucket.token !== null) {
    const host = hostLine(rng, bucket);
    if (rng() < 0.3) {
      parts.push(host);
    } else if (rng() < 0.5) {
      parts.push(host);
      addContent();
    } else {
      addContent();
      parts.push(host);
    }
  } else {
    addContent();
    if (rng() < 0.6) addContent();
  }

  return { body: humanise(rng, parts.join(" "), bucket.key), bucket: bucket.key };
}

/** "Mr." is masked first so it is not mistaken for the end of a sentence. */
function sentenceCount(body: string): number {
  const masked = body.replaceAll("Mr.", "Mr");
  const matches = masked.match(/[.!?](\s|$)/g);
  const count = matches ? matches.length : 0;
  return masked.endsWith(".") || masked.endsWith("!") || masked.endsWith("?")
    ? count
    : count + 1;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface PlannedReview {
  authorId: string;
  rating: number;
  body: string;
  bucket: HostBucket;
  createdAt: Date;
}

interface ListingPlan {
  listingId: string;
  title: string;
  count: number;
  fours: number;
  expectedAverage: number;
  buckets: Record<HostBucket, number>;
  shortBodies: number;
  maxBodyLength: number;
  reviews: PlannedReview[];
}

function emptyBuckets(): Record<HostBucket, number> {
  return { full: 0, first: 0, generic: 0, none: 0 };
}

/** Backdated timestamps, newest-first density, always spanning ~18 months. */
function buildDates(rng: () => number, count: number, now: number): Date[] {
  const dayMs = 86_400_000;
  const offsets: number[] = [];

  // Anchor the span so the report always shows a genuinely old and a recent one.
  offsets.push(SPREAD_DAYS - 20 + rng() * 18);
  offsets.push(3 + rng() * 12);
  while (offsets.length < count) {
    offsets.push(2 + Math.pow(rng(), RECENCY_BIAS) * (SPREAD_DAYS - 2));
  }

  return offsets
    .map((days) => new Date(now - Math.round(days * dayMs) - Math.floor(rng() * dayMs)))
    .sort((a, b) => a.getTime() - b.getTime());
}

function planListing(
  listing: { id: string; title: string },
  guestIds: string[],
  now: number,
  usedBodies: Set<string>
): ListingPlan {
  const rng = makeRng(`staywithme:reviews:v1:${listing.id}`);

  const count = pick(rng, VALID_COUNTS);
  const fours = foursNeeded(count);
  if (fours === null) throw new Error(`No valid 4/5 mix for count ${count}`);

  if (guestIds.length < count) {
    throw new Error(
      `Guest pool of ${guestIds.length} is too small for ${count} reviews on "${listing.title}"`
    );
  }

  // Distinct authors — @@unique([listingId, authorId]) allows exactly one each.
  const authors = shuffled(rng, guestIds).slice(0, count);
  const dates = buildDates(rng, count, now);

  // Ratings: 5 everywhere, then scatter the 4s. The two newest stay at 5 so the
  // top of the listing page reads clean.
  const ratings = new Array<number>(count).fill(5);
  const eligible = shuffled(
    rng,
    Array.from({ length: Math.max(1, count - 2) }, (_, i) => i)
  );
  for (let i = 0; i < fours; i++) ratings[eligible[i]] = 4;

  const reviews: PlannedReview[] = [];
  const buckets = emptyBuckets();

  for (let i = 0; i < count; i++) {
    // `usedBodies` spans every listing in the run, so no two reviews anywhere
    // share a body. Short copy means collisions do happen; retry until unique.
    let { body, bucket } = composeBody(rng, ratings[i]);
    for (let attempt = 0; attempt < 200 && usedBodies.has(body); attempt++) {
      ({ body, bucket } = composeBody(rng, ratings[i]));
    }
    if (usedBodies.has(body)) {
      throw new Error(
        `Could not build a distinct body for "${listing.title}" review ${i + 1}`
      );
    }
    usedBodies.add(body);
    buckets[bucket]++;

    reviews.push({
      authorId: authors[i],
      rating: ratings[i],
      body,
      bucket,
      createdAt: dates[i],
    });
  }

  const lengths = reviews.map((r) => r.body.length);

  const plan: ListingPlan = {
    listingId: listing.id,
    title: listing.title,
    count,
    fours,
    expectedAverage: round2((5 * count - fours) / count),
    buckets,
    shortBodies: lengths.filter((n) => n <= SHORT_BODY_LENGTH).length,
    maxBodyLength: Math.max(...lengths),
    reviews,
  };

  assertPlan(plan);
  return plan;
}

/** Everything the product owner asked for, checked before a single row is written. */
function assertPlan(plan: ListingPlan): void {
  const { title, count, reviews } = plan;
  const fail = (msg: string): never => {
    throw new Error(`Plan assertion failed for "${title}": ${msg}`);
  };

  if (count < MIN_REVIEWS || count > MAX_REVIEWS) {
    fail(`count ${count} outside ${MIN_REVIEWS}-${MAX_REVIEWS}`);
  }
  if (reviews.length !== count) fail(`built ${reviews.length} reviews, expected ${count}`);

  if (reviews.some((r) => r.rating !== 4 && r.rating !== 5)) {
    fail("found a rating outside {4, 5}");
  }

  const mean = reviews.reduce((a, r) => a + r.rating, 0) / count;
  if (round2(mean) !== TARGET_AVERAGE) {
    fail(`average ${round2(mean)} != ${TARGET_AVERAGE} (${count} reviews, ${plan.fours} fours)`);
  }
  if (plan.expectedAverage !== TARGET_AVERAGE) fail("expectedAverage drifted from target");

  const authors = new Set(reviews.map((r) => r.authorId));
  if (authors.size !== count) fail("duplicate author — violates @@unique([listingId, authorId])");

  const bodies = new Set(reviews.map((r) => r.body));
  if (bodies.size !== count) fail(`only ${bodies.size}/${count} distinct bodies`);

  // Short, plain-English, one or two sentences — the realism contract.
  for (const r of reviews) {
    if (r.body.length > MAX_BODY_LENGTH) {
      fail(`a body is ${r.body.length} chars, over the ${MAX_BODY_LENGTH} cap: "${r.body}"`);
    }
    if (sentenceCount(r.body) > 2) fail(`a body runs to 3+ sentences: "${r.body}"`);
    if (!/^[\x20-\x7E]+$/.test(r.body)) fail(`a body has non-ASCII characters: "${r.body}"`);
    if (r.body.includes("  ")) fail(`a body has a double space: "${r.body}"`);
  }

  if (plan.shortBodies / count < MIN_SHORT_SHARE) {
    fail(
      `only ${plan.shortBodies}/${count} bodies are short (<=${SHORT_BODY_LENGTH} chars), ` +
        `wanted at least ${Math.ceil(MIN_SHORT_SHARE * count)}`
    );
  }

  // A 4 must carry a visible gripe, otherwise it reads exactly like a 5.
  const flat = reviews.filter(
    (r) => r.rating === 4 && !NIGGLES.some((n) => r.body.toLowerCase().includes(n.toLowerCase().slice(0, -1)))
  );
  if (flat.length > 0) fail(`a 4-star body carries no gripe: "${flat[0].body}"`);

  // Host reference is rotated, not stamped on most of them. Per-listing bands
  // are wide because n is ~90; the tight check is global, in assertRun.
  const share = (bucket: HostBucket) => plan.buckets[bucket] / count;
  if (share("none") < 0.3 || share("none") > 0.7) {
    fail(`${plan.buckets.none}/${count} bodies mention no host, wanted roughly half`);
  }
  if (share("full") > 0.32) fail(`${plan.buckets.full}/${count} bodies say "${HOST_NAME}", too many`);
  if (reviews.some((r) => r.bucket === "none" && r.body.includes(HOST_FIRST_NAME))) {
    fail("a no-host body still names the host");
  }

  const times = reviews.map((r) => r.createdAt.getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  if (spanDays < SPREAD_DAYS * 0.8) fail(`createdAt span of ${Math.round(spanDays)}d is too narrow`);
  if (times.some((t) => t > Date.now())) fail("a createdAt is in the future");
}

/**
 * Across the whole run the host-reference mix has to land near its targets.
 * With ~460 reviews the sampling noise is small enough to check tightly.
 */
function assertRun(plans: ListingPlan[]): Record<HostBucket, number> {
  const totals = emptyBuckets();
  let reviews = 0;
  for (const plan of plans) {
    reviews += plan.count;
    for (const bucket of HOST_BUCKETS) totals[bucket.key] += plan.buckets[bucket.key];
  }

  for (const bucket of HOST_BUCKETS) {
    const target = bucket.weight / HOST_BUCKET_WEIGHT;
    const actual = totals[bucket.key] / reviews;
    if (Math.abs(actual - target) > 0.07) {
      throw new Error(
        `Host reference "${bucket.key}" landed at ${(actual * 100).toFixed(1)}% ` +
          `against a ${(target * 100).toFixed(0)}% target`
      );
    }
  }

  const bodies = plans.flatMap((p) => p.reviews.map((r) => r.body));
  if (new Set(bodies).size !== bodies.length) {
    throw new Error(`only ${new Set(bodies).size}/${bodies.length} distinct bodies across all listings`);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Database work — all of it scoped to synthetic rows
// ---------------------------------------------------------------------------

function syntheticUserWhere(): Prisma.UserWhereInput {
  return { email: { endsWith: SYNTHETIC_EMAIL_SUFFIX } };
}

/** Explicit inverse — real users mostly have a NULL email, which `NOT` drops. */
function realUserWhere(): Prisma.UserWhereInput {
  return { OR: [{ email: null }, { email: { not: { endsWith: SYNTHETIC_EMAIL_SUFFIX } } }] };
}

/** Creates any missing synthetic guests, then returns the whole pool's ids. */
async function ensureGuests(dryRun: boolean): Promise<string[]> {
  const pool = buildGuestPool();
  const existing = await prisma.user.findMany({
    where: syntheticUserWhere(),
    select: { id: true, email: true },
  });
  const byEmail = new Map(existing.map((u) => [u.email!, u.id]));
  const missing = pool.filter((g) => !byEmail.has(g.email));

  if (missing.length > 0) {
    console.log(`Creating ${missing.length} synthetic guest(s)…`);
    if (dryRun) return existing.map((u) => u.id);

    const rng = makeRng("staywithme:synthetic-guest-createdat:v1");
    await prisma.user.createMany({
      data: missing.map((g) => ({
        ...g,
        phone: null,
        passwordHash: null,
        image: null,
        roles: ["GUEST"],
        isAdmin: false,
        // Inert: no provider will ever mint a session for these accounts.
        suspended: true,
        // Signed up some time before their oldest review would have been left.
        createdAt: new Date(
          Date.now() - (SPREAD_DAYS + 30 + Math.floor(rng() * 400)) * 86_400_000
        ),
      })),
      skipDuplicates: true,
    });
  }

  const all = await prisma.user.findMany({
    where: syntheticUserWhere(),
    select: { id: true },
    orderBy: { email: "asc" },
  });
  return all.map((u) => u.id);
}

async function resetSynthetic(): Promise<void> {
  const users = await prisma.user.findMany({
    where: syntheticUserWhere(),
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log("No synthetic users found — nothing to reset.");
    return;
  }

  const reviews = await prisma.review.deleteMany({ where: { authorId: { in: ids } } });
  const deleted = await prisma.user.deleteMany({ where: syntheticUserWhere() });
  console.log(
    `Reset: deleted ${reviews.count} synthetic review(s) and ${deleted.count} synthetic user(s).`
  );
  console.log("Real users and their reviews were not touched.");
}

async function report(): Promise<void> {
  const listings = await prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  console.log("");
  console.log("Listing                                      count   avg    min  max  oldest       newest");
  console.log("-".repeat(97));

  for (const l of listings) {
    const rows = await prisma.review.findMany({
      where: { listingId: l.id, status: "APPROVED" },
      select: { rating: true, createdAt: true, body: true },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) {
      console.log(`${l.title.slice(0, 42).padEnd(44)}${"0".padStart(5)}   -`);
      continue;
    }
    const ratings = rows.map((r) => r.rating);
    const avg = round2(ratings.reduce((a, r) => a + r, 0) / ratings.length);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    console.log(
      `${l.title.slice(0, 42).padEnd(44)}${String(rows.length).padStart(5)}  ` +
        `${avg.toFixed(2)}  ${String(Math.min(...ratings)).padStart(4)} ` +
        `${String(Math.max(...ratings)).padStart(4)}  ${day(rows[0].createdAt)}   ` +
        `${day(rows[rows.length - 1].createdAt)}`
    );
  }

  const [total, synthetic, realUsers] = await Promise.all([
    prisma.review.count(),
    prisma.user.count({ where: syntheticUserWhere() }),
    prisma.user.count({ where: realUserWhere() }),
  ]);
  console.log("-".repeat(97));
  console.log(`Total reviews: ${total} | synthetic guests: ${synthetic} | real users: ${realUsers}`);

  // Read the copy back out of the database and check the realism contract held.
  const bodies = (
    await prisma.review.findMany({
      where: { author: syntheticUserWhere() },
      select: { body: true },
    })
  ).map((r) => r.body);

  if (bodies.length === 0) return;

  const lengths = bodies.map((b) => b.length);
  const share = (n: number) => `${((n / bodies.length) * 100).toFixed(1)}%`;
  const withFull = bodies.filter((b) => b.includes(HOST_NAME)).length;
  const withFirst = bodies.filter((b) => !b.includes(HOST_NAME) && b.includes(HOST_FIRST_NAME)).length;
  const withGeneric = bodies.filter(
    (b) => !b.includes(HOST_FIRST_NAME) && /\bhost\b/i.test(b)
  ).length;
  const noHost = bodies.length - withFull - withFirst - withGeneric;

  console.log("");
  console.log(
    `Body length: max ${Math.max(...lengths)} (cap ${MAX_BODY_LENGTH}), ` +
      `avg ${Math.round(lengths.reduce((a, n) => a + n, 0) / lengths.length)}, ` +
      `min ${Math.min(...lengths)}, ` +
      `${share(lengths.filter((n) => n <= SHORT_BODY_LENGTH).length)} are one-liners ` +
      `(<=${SHORT_BODY_LENGTH} chars)`
  );
  console.log(
    `Host reference: "${HOST_NAME}" ${share(withFull)} | "${HOST_FIRST_NAME}" ${share(withFirst)} | ` +
      `host/the host ${share(withGeneric)} | none ${share(noHost)}`
  );
  console.log(`Distinct bodies: ${new Set(bodies).size}/${bodies.length}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const dryRun = has("--dry-run");
  const force = has("--force");

  if (has("--reset")) {
    await resetSynthetic();
    return;
  }
  if (has("--verify")) {
    await report();
    return;
  }
  if (has("--sample")) {
    const rng = makeRng("staywithme:sample-preview");
    const wanted: Array<[number, HostBucket]> = [
      [5, "full"], [5, "first"], [5, "generic"], [5, "none"], [5, "none"],
      [5, "full"], [5, "generic"], [5, "none"], [5, "first"], [5, "none"],
      [4, "none"], [4, "full"], [4, "generic"], [4, "first"], [4, "none"],
    ];
    const seen = new Set<string>();
    const lengths: number[] = [];

    console.log("Sample bodies across both ratings and all four host buckets:\n");
    for (const [rating, bucket] of wanted) {
      let built = composeBody(rng, rating);
      for (let i = 0; i < 4000 && (built.bucket !== bucket || seen.has(built.body)); i++) {
        built = composeBody(rng, rating);
      }
      seen.add(built.body);
      lengths.push(built.body.length);
      const label = built.bucket === "none" ? "no host" : built.bucket;
      console.log(`[${rating}*|${label.padEnd(7)}|${String(built.body.length).padStart(3)}ch] ${built.body}`);
    }

    // Independent read on the distribution the generator actually produces.
    const tally = emptyBuckets();
    let longest = 0;
    for (let i = 0; i < 20_000; i++) {
      const built = composeBody(rng, i % 32 === 0 ? 4 : 5);
      tally[built.bucket]++;
      longest = Math.max(longest, built.body.length);
    }
    console.log(
      `\nOver 20000 draws: Mr. Chandra ${(tally.full / 200).toFixed(1)}% | ` +
        `Chandra ${(tally.first / 200).toFixed(1)}% | host ${(tally.generic / 200).toFixed(1)}% | ` +
        `none ${(tally.none / 200).toFixed(1)}% | longest body ${longest} chars (cap ${MAX_BODY_LENGTH})`
    );
    return;
  }

  console.log(
    `Valid review counts that can average ${TARGET_AVERAGE}: ` +
      `${VALID_COUNTS.length} of ${MAX_REVIEWS - MIN_REVIEWS + 1} in [${MIN_REVIEWS}, ${MAX_REVIEWS}]`
  );

  const guestIds = await ensureGuests(dryRun);
  if (dryRun && guestIds.length < MAX_REVIEWS) {
    console.log("Dry run: synthetic guests do not exist yet, planning against a stub pool.");
    while (guestIds.length < USER_POOL_SIZE) guestIds.push(`stub-${guestIds.length}`);
  }
  console.log(`Synthetic guest pool: ${guestIds.length} user(s).`);

  const listings = await prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Published listings: ${listings.length}`);

  const syntheticIds = new Set(guestIds);
  const now = Date.now();

  // Plan every listing up front: body uniqueness and the host-reference mix are
  // both run-wide properties, so they can only be checked once all plans exist.
  const usedBodies = new Set<string>();
  const plans = listings.map((listing) => planListing(listing, guestIds, now, usedBodies));
  const mix = assertRun(plans);
  const planned = plans.reduce((a, p) => a + p.count, 0);
  const pct = (n: number) => `${((n / planned) * 100).toFixed(1)}%`;
  console.log(
    `Planned ${planned} bodies, all distinct. Host reference: ` +
      `"${HOST_NAME}" ${pct(mix.full)}, "${HOST_FIRST_NAME}" ${pct(mix.first)}, ` +
      `host ${pct(mix.generic)}, none ${pct(mix.none)}. ` +
      `Longest body ${Math.max(...plans.map((p) => p.maxBodyLength))} chars.`
  );

  for (const plan of plans) {
    const listing = { id: plan.listingId, title: plan.title };
    const existing = await prisma.review.findMany({
      where: { listingId: listing.id, authorId: { in: guestIds } },
      select: { id: true, rating: true, status: true },
    });

    // Reconcile rather than blindly skip: a synthetic guest deleted from the
    // admin UI cascades away their reviews, which would leave the listing short
    // and drag the average off 4.97. Re-running the seed must repair that.
    const healthy =
      existing.length === plan.count &&
      existing.every((r) => r.status === "APPROVED" && (r.rating === 4 || r.rating === 5)) &&
      round2(existing.reduce((a, r) => a + r.rating, 0) / existing.length) === TARGET_AVERAGE;

    if (healthy && !force) {
      console.log(
        `· ${listing.title} — ${existing.length} synthetic review(s) at ${TARGET_AVERAGE}, skipping.`
      );
      continue;
    }

    if (dryRun) {
      console.log(
        `· ${listing.title} — would write ${plan.count} reviews ` +
          `(${plan.count - plan.fours}×5 + ${plan.fours}×4 = ${plan.expectedAverage}), ` +
          `${plan.shortBodies} one-liners, longest ${plan.maxBodyLength} chars.`
      );
      continue;
    }

    if (existing.length > 0) {
      const reason = force
        ? "--force"
        : `drifted: ${existing.length}/${plan.count} reviews, avg ` +
          `${round2(existing.reduce((a, r) => a + r.rating, 0) / existing.length)}`;
      // Only ever removes rows authored by synthetic guests.
      const removed = await prisma.review.deleteMany({
        where: { listingId: listing.id, authorId: { in: guestIds } },
      });
      console.log(`  (${reason}) rebuilding — removed ${removed.count} synthetic review(s)`);
    }

    // Never collide with a genuine guest review on the same listing.
    const realAuthors = await prisma.review.findMany({
      where: { listingId: listing.id, NOT: { authorId: { in: guestIds } } },
      select: { authorId: true },
    });
    const blocked = new Set(realAuthors.map((r) => r.authorId));
    const rows = plan.reviews.filter(
      (r) => syntheticIds.has(r.authorId) && !blocked.has(r.authorId)
    );

    const created = await prisma.review.createMany({
      data: rows.map((r) => ({
        listingId: listing.id,
        authorId: r.authorId,
        rating: r.rating,
        body: r.body,
        status: "APPROVED",
        createdAt: r.createdAt,
      })),
      skipDuplicates: true,
    });

    console.log(
      `✓ ${listing.title} — ${created.count} reviews ` +
        `(${plan.count - plan.fours}×5 + ${plan.fours}×4 → ${plan.expectedAverage}), ` +
        `${plan.shortBodies} one-liners, ${plan.count - plan.buckets.none} mention a host.`
    );
  }

  if (!dryRun) await report();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
