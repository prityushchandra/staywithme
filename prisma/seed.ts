// Seed script — demo data for MyBnB Sub-project #1.
// Demo photos are from Unsplash (permissive license, original photographers —
// NOT Airbnb assets). Run with: npm run db:seed

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const AMENITIES = [
  { key: "wifi", label: "Wi-Fi", icon: "wifi" },
  { key: "kitchen", label: "Kitchen", icon: "utensils" },
  { key: "parking", label: "Free parking", icon: "car" },
  { key: "pool", label: "Pool", icon: "waves" },
  { key: "ac", label: "Air conditioning", icon: "snowflake" },
  { key: "washer", label: "Washer", icon: "washing-machine" },
  { key: "tv", label: "TV", icon: "tv" },
  { key: "workspace", label: "Dedicated workspace", icon: "laptop" },
  { key: "heating", label: "Heating", icon: "flame" },
  { key: "pets", label: "Pets allowed", icon: "paw-print" },
];

const CANCELLATION_TEXT = [
  {
    policy: "FLEXIBLE" as const,
    title: "Flexible",
    description:
      "Free cancellation up to 24 hours before check-in for a full refund of the nightly total. Cancel within 24 hours of check-in and the first night is non-refundable, but every remaining night is refunded 100%. The Platform Fee is always non-refundable.",
  },
  {
    policy: "MODERATE" as const,
    title: "Moderate",
    description:
      "Free cancellation up to 5 days before check-in for a full refund of the nightly total. Cancel after that and you're refunded 50% of the nightly total (the first night is non-refundable). The Platform Fee is always non-refundable.",
  },
  {
    policy: "STRICT" as const,
    title: "Strict",
    description:
      "Cancel up to 7 days before check-in for a 50% refund of the nightly total (the first night is non-refundable). Within 7 days of check-in the booking is non-refundable. The Platform Fee is always non-refundable.",
  },
];

// Demo listings — original descriptions, Unsplash photo URLs.
const LISTINGS: Array<{
  title: string;
  description: string;
  propertyType: Prisma.ListingCreateInput["propertyType"];
  roomType: Prisma.ListingCreateInput["roomType"];
  city: string;
  country: string;
  addressLine: string;
  lat: number;
  lng: number;
  bedrooms: number;
  bathrooms: number;
  beds: number;
  maxGuests: number;
  basePrice: number; // minor units (paise)
  cancellationPolicy: Prisma.ListingCreateInput["cancellationPolicy"];
  amenityKeys: string[];
  images: string[];
}> = [
  {
    title: "Ocean View Villa with Infinity Pool",
    description:
      "Wake up to the sound of waves in this bright, airy villa perched above the coast. Floor-to-ceiling windows frame the sea, and the infinity pool blends into the horizon at sunset. Spacious living areas, a fully equipped kitchen, and a shaded terrace make it ideal for a relaxed getaway.",
    propertyType: "VILLA",
    roomType: "ENTIRE",
    city: "Goa",
    country: "India",
    addressLine: "Vagator Cliff Road",
    lat: 15.5994,
    lng: 73.7444,
    bedrooms: 3,
    bathrooms: 3,
    beds: 4,
    maxGuests: 6,
    basePrice: 880000,
    cancellationPolicy: "MODERATE",
    amenityKeys: ["wifi", "pool", "kitchen", "ac", "parking", "tv"],
    images: [
      "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=1200&q=80",
      "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80",
    ],
  },
  {
    title: "Cozy Mountain Cabin in the Pines",
    description:
      "A snug timber cabin tucked among tall pines, perfect for unplugging. Curl up by the fireplace with a book, sip coffee on the deck at dawn, and explore the trails that start right at the doorstep. Warm, woody interiors and a well-stocked kitchen make it feel like home.",
    propertyType: "CABIN",
    roomType: "ENTIRE",
    city: "Manali",
    country: "India",
    addressLine: "Old Manali Hillside",
    lat: 32.2566,
    lng: 77.1887,
    bedrooms: 2,
    bathrooms: 1,
    beds: 3,
    maxGuests: 4,
    basePrice: 240000,
    cancellationPolicy: "FLEXIBLE",
    amenityKeys: ["wifi", "kitchen", "heating", "parking", "pets"],
    images: [
      "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=1200&q=80",
      "https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=1200&q=80",
      "https://images.unsplash.com/photo-1476231682828-37e571bc172f?w=1200&q=80",
    ],
  },
  {
    title: "Modern City Loft Near the Riverfront",
    description:
      "A stylish open-plan loft in the heart of the city, steps from cafes, galleries, and the riverside promenade. High ceilings, exposed brick, and a dedicated workspace make it great for both work and play. Sleek bathroom, fast Wi-Fi, and a comfy queen bed round it out.",
    propertyType: "LOFT",
    roomType: "ENTIRE",
    city: "Bengaluru",
    country: "India",
    addressLine: "Indiranagar 12th Main",
    lat: 12.9719,
    lng: 77.6412,
    bedrooms: 1,
    bathrooms: 1,
    beds: 1,
    maxGuests: 2,
    basePrice: 320000,
    cancellationPolicy: "STRICT",
    amenityKeys: ["wifi", "kitchen", "ac", "workspace", "tv", "washer"],
    images: [
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80",
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80",
    ],
  },
  {
    title: "Private Room in a Heritage Cottage",
    description:
      "A charming private room in a restored heritage cottage with a leafy garden. Enjoy a quiet, comfortable stay with shared access to a sunny common lounge and home-cooked breakfast options nearby. A great base for exploring the old town on foot.",
    propertyType: "COTTAGE",
    roomType: "PRIVATE",
    city: "Puducherry",
    country: "India",
    addressLine: "White Town, Rue Romain Rolland",
    lat: 11.9333,
    lng: 79.8333,
    bedrooms: 1,
    bathrooms: 1,
    beds: 1,
    maxGuests: 2,
    basePrice: 180000,
    cancellationPolicy: "FLEXIBLE",
    amenityKeys: ["wifi", "ac", "parking"],
    images: [
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80",
    ],
  },
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@mybnb.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin12345";

  // Platform settings (single row).
  await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  // Cancellation policy text.
  for (const c of CANCELLATION_TEXT) {
    await prisma.cancellationPolicyText.upsert({
      where: { policy: c.policy },
      update: { title: c.title, description: c.description },
      create: c,
    });
  }

  // Amenities.
  const amenityByKey: Record<string, string> = {};
  for (const a of AMENITIES) {
    const row = await prisma.amenity.upsert({
      where: { key: a.key },
      update: { label: a.label, icon: a.icon },
      create: a,
    });
    amenityByKey[a.key] = row.id;
  }

  // Admin user. Signs in by phone OTP like everyone else (ADMIN_PHONE).
  const adminPhone = process.env.ADMIN_PHONE ?? null;
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isAdmin: true, phone: adminPhone },
    create: {
      email: adminEmail,
      phone: adminPhone,
      name: "Platform Admin",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      roles: ["GUEST"],
      isAdmin: true,
    },
  });

  // Demo host.
  const host = await prisma.user.upsert({
    where: { email: "host@mybnb.local" },
    update: { roles: ["GUEST", "HOST"] },
    create: {
      email: "host@mybnb.local",
      name: "Asha Menon",
      passwordHash: await bcrypt.hash("host12345", 10),
      roles: ["GUEST", "HOST"],
    },
  });

  // Demo guests (reviewers).
  const guest = await prisma.user.upsert({
    where: { email: "guest@mybnb.local" },
    update: {},
    create: {
      email: "guest@mybnb.local",
      name: "Demo Guest",
      passwordHash: await bcrypt.hash("guest12345", 10),
      roles: ["GUEST"],
    },
  });

  const guest2 = await prisma.user.upsert({
    where: { email: "guest2@mybnb.local" },
    update: {},
    create: {
      email: "guest2@mybnb.local",
      name: "Rahul Verma",
      passwordHash: await bcrypt.hash("guest12345", 10),
      roles: ["GUEST"],
    },
  });

  // Demo listings — published so they appear publicly, plus one pending for the
  // admin approval queue demo.
  const publishedListingIds: string[] = [];
  for (let i = 0; i < LISTINGS.length; i++) {
    const l = LISTINGS[i];
    const status = i === LISTINGS.length - 1 ? "PENDING" : "PUBLISHED";

    // Avoid duplicate listings on re-seed: delete prior demo listing by title+host.
    await prisma.listing.deleteMany({ where: { hostId: host.id, title: l.title } });

    const created = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: l.title,
        description: l.description,
        propertyType: l.propertyType,
        roomType: l.roomType,
        addressLine: l.addressLine,
        city: l.city,
        country: l.country,
        lat: l.lat,
        lng: l.lng,
        bedrooms: l.bedrooms,
        bathrooms: l.bathrooms,
        beds: l.beds,
        maxGuests: l.maxGuests,
        basePrice: l.basePrice,
        cancellationPolicy: l.cancellationPolicy,
        status,
        images: {
          create: l.images.map((url, idx) => ({
            url,
            order: idx,
            isCover: idx === 0,
          })),
        },
        amenities: {
          create: l.amenityKeys.map((k) => ({ amenityId: amenityByKey[k] })),
        },
      },
    });
    if (status === "PUBLISHED") publishedListingIds.push(created.id);
  }

  // Demo reviews — APPROVED so ratings render out of the box. Reviews of deleted
  // listings cascade away on re-seed, so the new listing ids start review-free.
  const REVIEWS: Array<{ listingIdx: number; authorId: string; rating: number; body: string }> = [
    {
      listingIdx: 0,
      authorId: guest.id,
      rating: 5,
      body: "Stunning views and the pool was even better in person. Spotless, spacious, and the host was super responsive over WhatsApp. Would happily come back.",
    },
    {
      listingIdx: 0,
      authorId: guest2.id,
      rating: 4,
      body: "Gorgeous villa and a great location. Knocked off a star only because the Wi-Fi was patchy on the terrace, but everything else was excellent.",
    },
    {
      listingIdx: 1,
      authorId: guest.id,
      rating: 5,
      body: "The cabin is exactly as cosy as it looks. Woke up to birdsong and the trails right outside are wonderful. Perfect quiet getaway.",
    },
  ];

  for (const r of REVIEWS) {
    const listingId = publishedListingIds[r.listingIdx];
    if (!listingId) continue;
    await prisma.review.create({
      data: {
        listingId,
        authorId: r.authorId,
        rating: r.rating,
        body: r.body,
        status: "APPROVED",
      },
    });
  }

  console.log("Seed complete:");
  console.log(`  Admin: ${adminEmail} / ${adminPassword}`);
  console.log("  Host:  host@mybnb.local / host12345");
  console.log("  Guest: guest@mybnb.local / guest12345");
  console.log(`  Listings: ${LISTINGS.length - 1} published, 1 pending approval`);
  console.log("  Reviews: 3 approved across 2 published listings");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
