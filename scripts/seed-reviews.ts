// Seed realistic synthetic reviews for every PUBLISHED listing.
//
//   npm run db:seed-reviews              # idempotent seed (skips listings already on target)
//   npm run db:seed-reviews -- --force   # reconcile every listing, even the healthy ones
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
const MIN_REVIEWS = 20;
const MAX_REVIEWS = 45;

/**
 * Every listing lands on its OWN average, to 2 decimal places. Five listings
 * all showing 4.97 reads as fabricated; a spread does not.
 *
 * Assigned by listing creation order, so a listing keeps its number forever.
 * Deliberately not monotonic — the first few listings should not look sorted.
 * The ladder covers the whole 4.86-4.97 band, so it also stays distinct if more
 * listings are published later.
 */
const TARGET_AVERAGES = [
  4.88, 4.95, 4.91, 4.97, 4.93, 4.86, 4.96, 4.89, 4.94, 4.87, 4.92, 4.9,
] as const;

/** Reviews are backdated across roughly the last 13 months. */
const SPREAD_DAYS = 400;
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

/**
 * A 4-star review is NOT a complaint here — it is a shorter, cooler thank-you.
 * "Good stay." rather than "Good stay, but the lift is slow."
 */
const FOUR_STAR_MAX_WORDS = 6;
const FOUR_STAR_MAX_LENGTH = 48;

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
// Rating mix — Review.rating is an Int, so 4.88 has to come out of the mix
// ---------------------------------------------------------------------------

interface RatingMix {
  /** Total reviews. */
  count: number;
  /** How many of them are 4s; the rest are 5s. */
  fours: number;
  /** The mean those two produce, already rounded the way the app rounds. */
  average: number;
}

/**
 * A mean sitting exactly on an x.xx5 boundary rounds up in JS but not in every
 * other engine, formatter or database, so the UI and a report could disagree by
 * 0.01. Those mixes are thrown away rather than relied upon.
 */
function onRoundingBoundary(mean: number): boolean {
  const scaled = mean * 1000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9 && Math.round(scaled) % 10 === 5;
}

/**
 * Every (count, fours) pair in the window whose mean really does round to
 * `target`. The filter is the app's own rounding function, not an epsilon
 * window: with N=40 and one 4 the mean is 4.975, which rounds UP to 4.98, and
 * an epsilon comparison would happily call that 4.97.
 */
function findMixes(target: number, minCount: number, maxCount: number): RatingMix[] {
  const mixes: RatingMix[] = [];
  for (let count = minCount; count <= maxCount; count++) {
    // fours < count keeps at least one 5 in the mix; fours >= 1 is implied for
    // any target below 5, but is asserted rather than assumed.
    for (let fours = 1; fours < count; fours++) {
      const mean = (5 * count - fours) / count;
      if (round2(mean) !== target) continue;
      if (onRoundingBoundary(mean)) continue;
      mixes.push({ count, fours, average: round2(mean) });
    }
  }
  return mixes;
}

/** Fails the whole run rather than quietly shipping a listing on 4.89. */
function mixesForTarget(target: number): RatingMix[] {
  const mixes = findMixes(target, MIN_REVIEWS, MAX_REVIEWS);
  if (mixes.length === 0) {
    throw new Error(
      `No mix of 4s and 5s with ${MIN_REVIEWS}-${MAX_REVIEWS} reviews averages ${target}. ` +
        `Widen the count window or move the target.`
    );
  }
  return mixes;
}

/** Listing n gets target n — stable, and distinct while the ladder lasts. */
function targetForIndex(index: number): number {
  return TARGET_AVERAGES[index % TARGET_AVERAGES.length];
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

/**
 * 4-star bodies. A 4 here is not a complaint — guests who liked the place but
 * did not gush leave two or three words, and that is exactly what this is.
 * Nothing in these pools may read as a criticism; assertPlan enforces it.
 */
const FOUR_STAR_PLAIN = [
  "Good stay.",
  "Nice place, comfortable.",
  "Clean and convenient.",
  "Pleasant stay, would return.",
  "Comfortable and quiet.",
  "Good value.",
  "Neat and tidy flat.",
  "Simple and comfortable.",
  "Good location.",
  "Clean flat, easy stay.",
  "Smooth check-in.",
  "Nice and quiet.",
  "Well kept flat.",
  "Comfortable bed, good sleep.",
  "Handy location, clean room.",
  "Easy stay.",
  "Good for a short trip.",
  "Safe and quiet society.",
  "Tidy and well located.",
  "Peaceful place.",
  "Pleasant and easy.",
  "Nice flat, good area.",
  "Clean, quiet, comfortable.",
  "Would stay again.",
  "Comfortable stay overall.",
  "Good stay, thanks.",
  "Lovely and clean.",
  "Value for money.",
  "Quiet and convenient.",
  "Clean and comfortable.",
  "Good place to stay.",
  "Decent and clean.",
  "Nice stay.",
  "Comfortable flat, easy check-in.",
  "Clean, calm, convenient.",
  "Happy with the stay.",
  "Well located and clean.",
  "Fine stay, nice flat.",
] as const;

/** Reads correctly for "Mr. Chandra", "Chandra" and "the host" alike. */
const FOUR_STAR_HOST_ANY = [
  "{H} was helpful.",
  "{H} was prompt.",
  "{H} replied quickly.",
  "{H} sorted everything.",
  "{H} was easy to reach.",
  "{H} made it easy.",
] as const;

/** Only used when the bucket carries an actual name. */
const FOUR_STAR_HOST_NAMED = [
  "Good stay, thanks {H}.",
  "Nice place, thanks {H}.",
  "Comfortable stay, thanks {H}.",
  "Thanks {H}, easy stay.",
  "Smooth stay, thanks {H}.",
] as const;

/** Only used by the generic bucket. */
const FOUR_STAR_HOST_GENERIC = [
  "Helpful host, good stay.",
  "Good stay, helpful host.",
  "Nice place, helpful host.",
  "Clean flat, helpful host.",
  "Responsive host, easy stay.",
] as const;

/**
 * Anything that would turn a 4 back into a gripe. Checked against every 4-star
 * body with spaces padded on both ends, so " but " also catches a leading "But".
 */
const CRITICISM_MARKERS = [
  " but ", "however", "though", "although", "except", "otherwise", "minor",
  "slow", "noisy", "noise", "tight", "cramped", "missed", "issue", "problem",
  "complain", "could be", "wish", "lack", "only ", "smell", "dated", "bit of",
  "n't", " not ", "unfortunately", "apart from", "downside", "average",
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

/** A terse, warm 4-star line. Short enough to read as a quick thank-you. */
function fourStarBody(rng: () => number, bucket: (typeof HOST_BUCKETS)[number]): string {
  if (bucket.token === null) return pick(rng, FOUR_STAR_PLAIN);
  const named = bucket.key !== "generic";
  const pool: string[] = named
    ? [...FOUR_STAR_HOST_ANY, ...FOUR_STAR_HOST_NAMED]
    : [...FOUR_STAR_HOST_ANY, ...FOUR_STAR_HOST_GENERIC];
  return capitalise(pick(rng, pool).replaceAll("{H}", bucket.token));
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
    // Two or three words, no nit. The host bucket is drawn the same way as for
    // a 5, so host mentions stay uncorrelated with the rating.
    parts.push(fourStarBody(rng, bucket));
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
  refCode: string | null;
  /** The 2-decimal average this listing must land on. */
  target: number;
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

/** Backdated timestamps, newest-first density, always spanning ~13 months. */
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

interface SeedListing {
  id: string;
  title: string;
  refCode: string | null;
}

function planListing(
  listing: SeedListing,
  target: number,
  guestIds: string[],
  now: number,
  usedBodies: Set<string>
): ListingPlan {
  // v2: the per-listing target and the 20-45 count window changed every plan,
  // so the seed string moves with them rather than silently reusing v1 draws.
  const rng = makeRng(`staywithme:reviews:v2:${target}:${listing.id}`);

  const { count, fours, average } = pick(rng, mixesForTarget(target));

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
    refCode: listing.refCode,
    target,
    count,
    fours,
    expectedAverage: average,
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
  const { title, count, target, reviews } = plan;
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
  if (round2(mean) !== target) {
    fail(`average ${round2(mean)} != ${target} (${count} reviews, ${plan.fours} fours)`);
  }
  if (plan.expectedAverage !== target) fail("expectedAverage drifted from target");

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

  // A 4 is a quieter compliment, never a complaint: a few words, nothing sour.
  for (const r of reviews.filter((r) => r.rating === 4)) {
    const words = r.body.trim().split(/\s+/).length;
    if (words < 2 || words > FOUR_STAR_MAX_WORDS) {
      fail(`a 4-star body runs to ${words} words (want 2-${FOUR_STAR_MAX_WORDS}): "${r.body}"`);
    }
    if (r.body.length > FOUR_STAR_MAX_LENGTH) {
      fail(`a 4-star body is ${r.body.length} chars, over ${FOUR_STAR_MAX_LENGTH}: "${r.body}"`);
    }
    if (sentenceCount(r.body) !== 1) fail(`a 4-star body is not a single line: "${r.body}"`);
    const probe = ` ${r.body.toLowerCase()} `;
    const marker = CRITICISM_MARKERS.find((m) => probe.includes(m));
    if (marker) fail(`a 4-star body reads as a complaint ("${marker.trim()}"): "${r.body}"`);
  }

  // Host reference is rotated, not stamped on most of them. The band widens as
  // n shrinks (2.5 binomial sigma) — at n=20 a 50% target really can land on
  // 13/20. The tight check is global, in assertRun.
  const band = (p: number) => Math.max(0.15, 2.5 * Math.sqrt((p * (1 - p)) / count));
  const share = (bucket: HostBucket) => plan.buckets[bucket] / count;
  if (Math.abs(share("none") - 0.5) > band(0.5)) {
    fail(`${plan.buckets.none}/${count} bodies mention no host, wanted roughly half`);
  }
  if (share("full") > 0.15 + band(0.15)) {
    fail(`${plan.buckets.full}/${count} bodies say "${HOST_NAME}", too many`);
  }
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
 * The corpus is now ~160 reviews rather than ~460, so the tolerance is one
 * sampling-noise step wider than it used to be.
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
    if (Math.abs(actual - target) > 0.09) {
      throw new Error(
        `Host reference "${bucket.key}" landed at ${(actual * 100).toFixed(1)}% ` +
          `against a ${(target * 100).toFixed(0)}% target`
      );
    }
  }

  const targets = plans.map((p) => p.target);
  if (new Set(targets).size !== targets.length) {
    throw new Error(
      `Two listings share a target average (${targets.join(", ")}) — ` +
        `the ladder only holds ${TARGET_AVERAGES.length} distinct values`
    );
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

/** Published listings in the order that fixes their target average. */
async function publishedListings(): Promise<SeedListing[]> {
  return prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, refCode: true },
    orderBy: { createdAt: "asc" },
  });
}

const hostBucketOf = (body: string): HostBucket => {
  if (body.includes(HOST_NAME)) return "full";
  if (body.includes(HOST_FIRST_NAME)) return "first";
  if (/\bhost\b/i.test(body)) return "generic";
  return "none";
};

/**
 * Reads every APPROVED review back out of the database and checks the contract
 * the product owner actually cares about, per listing. Returns the problems it
 * found so the caller can decide between printing and throwing.
 */
async function report(): Promise<string[]> {
  const listings = await publishedListings();
  const problems: string[] = [];
  const now = Date.now();

  console.log("");
  console.log(
    "Ref        Listing                             target  count   k   avg   " +
      "maxLen  1-liners  nonASCII  future  dupes  oldest       newest"
  );
  console.log("-".repeat(132));

  const corpus: string[] = [];

  for (const [index, l] of listings.entries()) {
    const target = targetForIndex(index);
    const rows = await prisma.review.findMany({
      where: { listingId: l.id, status: "APPROVED" },
      select: { rating: true, createdAt: true, body: true },
      orderBy: { createdAt: "asc" },
    });
    const label = `${(l.refCode ?? "-").padEnd(11)}${l.title.slice(0, 33).padEnd(35)}`;

    if (rows.length === 0) {
      console.log(`${label}${target.toFixed(2).padStart(6)}      0`);
      problems.push(`${l.refCode ?? l.title}: no approved reviews (target ${target})`);
      continue;
    }

    const ratings = rows.map((r) => r.rating);
    const bodies = rows.map((r) => r.body);
    corpus.push(...bodies);

    const avg = round2(ratings.reduce((a, r) => a + r, 0) / ratings.length);
    const fours = ratings.filter((r) => r === 4).length;
    const lengths = bodies.map((b) => b.length);
    const oneLiners = lengths.filter((n) => n <= SHORT_BODY_LENGTH).length;
    const nonAscii = bodies.filter((b) => !/^[\x20-\x7E]+$/.test(b)).length;
    const future = rows.filter((r) => r.createdAt.getTime() > now).length;
    const dupes = bodies.length - new Set(bodies).size;
    const day = (d: Date) => d.toISOString().slice(0, 10);

    console.log(
      label +
        `${target.toFixed(2).padStart(6)}  ` +
        `${String(rows.length).padStart(5)}  ${String(fours).padStart(2)}  ` +
        `${avg.toFixed(2).padStart(5)}  ${String(Math.max(...lengths)).padStart(6)}  ` +
        `${`${Math.round((oneLiners / rows.length) * 100)}%`.padStart(8)}  ` +
        `${String(nonAscii).padStart(8)}  ${String(future).padStart(6)}  ` +
        `${String(dupes).padStart(5)}  ${day(rows[0].createdAt)}   ` +
        `${day(rows[rows.length - 1].createdAt)}`
    );

    const flag = (msg: string) => problems.push(`${l.refCode ?? l.title}: ${msg}`);
    if (avg !== target) flag(`average ${avg.toFixed(2)} != target ${target.toFixed(2)}`);
    if (rows.length < MIN_REVIEWS || rows.length > MAX_REVIEWS) {
      flag(`count ${rows.length} outside ${MIN_REVIEWS}-${MAX_REVIEWS}`);
    }
    if (ratings.some((r) => r !== 4 && r !== 5)) flag("a rating outside {4, 5}");
    if (Math.max(...lengths) > MAX_BODY_LENGTH) {
      flag(`longest body ${Math.max(...lengths)} > ${MAX_BODY_LENGTH}`);
    }
    if (nonAscii > 0) flag(`${nonAscii} body/bodies contain non-ASCII characters`);
    if (future > 0) flag(`${future} review(s) dated in the future`);
    if (dupes > 0) flag(`${dupes} duplicate body/bodies`);
  }

  // Host mentions, per listing — the distribution has to look rotated, not
  // stamped on, and it must not correlate with the rating.
  console.log("");
  console.log(
    `Host mentions   Ref        "${HOST_NAME}"   "${HOST_FIRST_NAME}"   the host   none      (4-star bodies)`
  );
  console.log("-".repeat(132));

  for (const l of listings) {
    const rows = await prisma.review.findMany({
      where: { listingId: l.id, status: "APPROVED" },
      select: { body: true, rating: true },
    });
    if (rows.length === 0) continue;
    const tally = emptyBuckets();
    for (const r of rows) tally[hostBucketOf(r.body)]++;
    const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`.padStart(7);
    const fourStarHosted = rows.filter(
      (r) => r.rating === 4 && hostBucketOf(r.body) !== "none"
    ).length;
    const fourStars = rows.filter((r) => r.rating === 4).length;
    console.log(
      `                ${(l.refCode ?? "-").padEnd(11)}${pct(tally.full)}       ` +
        `${pct(tally.first)}   ${pct(tally.generic)}    ${pct(tally.none)}   ` +
        `   ${fourStarHosted}/${fourStars} name a host`
    );
  }

  const [total, synthetic, realUsers, realReviews] = await Promise.all([
    prisma.review.count(),
    prisma.user.count({ where: syntheticUserWhere() }),
    prisma.user.count({ where: realUserWhere() }),
    prisma.review.count({ where: { author: realUserWhere() } }),
  ]);
  console.log("-".repeat(132));
  console.log(
    `Total reviews: ${total} | synthetic guests: ${synthetic} | ` +
      `real users: ${realUsers} | reviews by real users: ${realReviews}`
  );

  // Whole-corpus view of the copy, read back from the database.
  const bodies = (
    await prisma.review.findMany({
      where: { author: syntheticUserWhere() },
      select: { body: true },
    })
  ).map((r) => r.body);

  if (bodies.length === 0) return problems;

  const lengths = bodies.map((b) => b.length);
  const share = (n: number) => `${((n / bodies.length) * 100).toFixed(1)}%`;
  const tally = emptyBuckets();
  for (const b of bodies) tally[hostBucketOf(b)]++;

  console.log("");
  console.log(
    `Body length: max ${Math.max(...lengths)} (cap ${MAX_BODY_LENGTH}), ` +
      `avg ${Math.round(lengths.reduce((a, n) => a + n, 0) / lengths.length)}, ` +
      `min ${Math.min(...lengths)}, ` +
      `${share(lengths.filter((n) => n <= SHORT_BODY_LENGTH).length)} are one-liners ` +
      `(<=${SHORT_BODY_LENGTH} chars)`
  );
  console.log(
    `Host reference: "${HOST_NAME}" ${share(tally.full)} | "${HOST_FIRST_NAME}" ${share(tally.first)} | ` +
      `host/the host ${share(tally.generic)} | none ${share(tally.none)}`
  );
  console.log(`Distinct bodies: ${new Set(bodies).size}/${bodies.length}`);
  if (new Set(corpus).size !== corpus.length) {
    problems.push(`only ${new Set(corpus).size}/${corpus.length} distinct bodies across all listings`);
  }
  return problems;
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
    const problems = await report();
    if (problems.length > 0) {
      console.log("");
      for (const p of problems) console.error(`FAIL  ${p}`);
      process.exitCode = 1;
    }
    return;
  }
  if (has("--sample")) {
    const rng = makeRng("staywithme:sample-preview");
    const wanted: Array<[number, HostBucket]> = [
      [5, "full"], [5, "first"], [5, "generic"], [5, "none"], [5, "none"],
      [5, "full"], [5, "generic"], [5, "none"], [5, "first"], [5, "none"],
      [4, "none"], [4, "none"], [4, "full"], [4, "generic"], [4, "first"],
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
    `Count window [${MIN_REVIEWS}, ${MAX_REVIEWS}]; ` +
      TARGET_AVERAGES.map((t) => `${t.toFixed(2)}:${mixesForTarget(t).length} mix(es)`).join(", ")
  );

  const guestIds = await ensureGuests(dryRun);
  if (dryRun && guestIds.length < MAX_REVIEWS) {
    console.log("Dry run: synthetic guests do not exist yet, planning against a stub pool.");
    while (guestIds.length < USER_POOL_SIZE) guestIds.push(`stub-${guestIds.length}`);
  }
  console.log(`Synthetic guest pool: ${guestIds.length} user(s).`);

  const listings = await publishedListings();
  console.log(
    `Published listings: ${listings.length}. Targets: ` +
      listings
        .map((l, i) => `${l.refCode ?? l.title.slice(0, 10)}=${targetForIndex(i).toFixed(2)}`)
        .join(", ")
  );

  const syntheticIds = new Set(guestIds);

  // Timestamps hang off midnight UTC, not the clock. Re-running an hour later
  // must not rewrite 160 createdAt values just because `now` moved — that is
  // what makes a second --force a genuine no-op.
  const now = Math.floor(Date.now() / 86_400_000) * 86_400_000;

  // Plan every listing up front: body uniqueness and the host-reference mix are
  // both run-wide properties, so they can only be checked once all plans exist.
  const usedBodies = new Set<string>();
  const plans = listings.map((listing, index) =>
    planListing(listing, targetForIndex(index), guestIds, now, usedBodies)
  );
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
    const label = `${plan.refCode ?? plan.title.slice(0, 12)} ${plan.title}`;
    const existingRows = await prisma.review.findMany({
      where: { listingId: plan.listingId, authorId: { in: guestIds } },
      select: { id: true, authorId: true, rating: true, body: true, status: true, createdAt: true },
    });
    // authorId is nullable now (admin-authored rows carry no account), but the
    // `in guestIds` filter already excludes those — this just proves it to TS.
    const existing = existingRows.filter(
      (r): r is typeof r & { authorId: string } => r.authorId !== null
    );

    // Reconcile rather than blindly skip: a synthetic guest deleted from the
    // admin UI cascades away their reviews, which would leave the listing short
    // and drag the average off its target. Re-running the seed must repair that.
    const healthy =
      existing.length === plan.count &&
      existing.every((r) => r.status === "APPROVED" && (r.rating === 4 || r.rating === 5)) &&
      round2(existing.reduce((a, r) => a + r.rating, 0) / existing.length) === plan.target;

    if (healthy && !force) {
      console.log(`· ${label} — ${existing.length} synthetic review(s) at ${plan.target}, skipping.`);
      continue;
    }

    if (dryRun) {
      console.log(
        `· ${label} — would hold ${plan.count} reviews ` +
          `(${plan.count - plan.fours}×5 + ${plan.fours}×4 = ${plan.expectedAverage}), ` +
          `against ${existing.length} synthetic row(s) today, ` +
          `${plan.shortBodies} one-liners, longest ${plan.maxBodyLength} chars.`
      );
      continue;
    }

    // Never collide with a genuine guest review on the same listing.
    const realAuthors = await prisma.review.findMany({
      where: { listingId: plan.listingId, NOT: { authorId: { in: guestIds } } },
      select: { authorId: true },
    });
    const blocked = new Set(realAuthors.map((r) => r.authorId));
    const wanted = new Map(
      plan.reviews
        .filter((r) => syntheticIds.has(r.authorId) && !blocked.has(r.authorId))
        .map((r) => [r.authorId, r])
    );

    // Row-level reconcile: delete the surplus, repair the drifted, add the
    // missing. Deletes are keyed on ids we just read back from the synthetic
    // author set, so a real guest's review can never be in the list. Doing it
    // this way (rather than delete-all + recreate) is what makes a second
    // --force report 0/0/0 instead of churning every row.
    const surplus = existing.filter((r) => !wanted.has(r.authorId));
    if (surplus.length > 0) {
      await prisma.review.deleteMany({ where: { id: { in: surplus.map((r) => r.id) } } });
    }

    let updated = 0;
    for (const row of existing) {
      const want = wanted.get(row.authorId);
      if (!want) continue;
      const drifted =
        row.rating !== want.rating ||
        row.body !== want.body ||
        row.status !== "APPROVED" ||
        row.createdAt.getTime() !== want.createdAt.getTime();
      if (!drifted) continue;
      await prisma.review.update({
        where: { id: row.id },
        data: {
          rating: want.rating,
          body: want.body,
          status: "APPROVED",
          createdAt: want.createdAt,
        },
      });
      updated++;
    }

    const have = new Set(existing.map((r) => r.authorId));
    const missing = [...wanted.values()].filter((r) => !have.has(r.authorId));
    const created = missing.length
      ? await prisma.review.createMany({
          data: missing.map((r) => ({
            listingId: plan.listingId,
            authorId: r.authorId,
            rating: r.rating,
            body: r.body,
            status: "APPROVED",
            createdAt: r.createdAt,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };

    const unchanged = plan.count - created.count - updated;
    console.log(
      `✓ ${label} — ${plan.count} reviews ` +
        `(${plan.count - plan.fours}×5 + ${plan.fours}×4 → ${plan.expectedAverage}): ` +
        `+${created.count} created, ~${updated} updated, -${surplus.length} removed, ` +
        `${unchanged} unchanged. ${plan.shortBodies} one-liners, ` +
        `${plan.count - plan.buckets.none} mention a host.`
    );
  }

  if (dryRun) return;

  await assertSeeded(plans);
  const problems = await report();
  if (problems.length > 0) {
    throw new Error(`Post-seed verification failed:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * The number the listing page will actually print, recomputed from the rows in
 * the database and put through the app's own rounding. A silent off-by-one here
 * ships a wrong average to production, so this throws rather than warns.
 */
async function assertSeeded(plans: ListingPlan[]): Promise<void> {
  for (const plan of plans) {
    const rows = await prisma.review.findMany({
      where: { listingId: plan.listingId, status: "APPROVED" },
      select: { rating: true, authorId: true },
    });
    const average = round2(rows.reduce((a, r) => a + r.rating, 0) / rows.length);
    if (rows.length !== plan.count || average !== plan.target) {
      const synthetic = await prisma.review.count({
        where: { listingId: plan.listingId, status: "APPROVED", author: syntheticUserWhere() },
      });
      throw new Error(
        `"${plan.title}" landed on ${rows.length} approved review(s) averaging ${average}, ` +
          `wanted ${plan.count} averaging ${plan.target}. ` +
          `${rows.length - synthetic} of those rows were written by real users, ` +
          `which the synthetic plan cannot compensate for.`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
