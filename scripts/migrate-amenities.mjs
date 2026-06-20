import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const AMENITIES = [
  { key: "wifi", label: "Wi-Fi", icon: "wifi" },
  { key: "ac", label: "Air conditioning", icon: "snowflake" },
  { key: "cooler", label: "Air cooler", icon: "fan" },
  { key: "parking", label: "Free parking", icon: "car" },
  { key: "ev_charger", label: "EV charger", icon: "plug-zap" },
  { key: "pool", label: "Pool", icon: "waves" },
  { key: "gym", label: "Gym", icon: "dumbbell" },
  { key: "tv", label: "TV", icon: "tv" },
  { key: "workspace", label: "Dedicated workspace", icon: "laptop" },
  { key: "washer", label: "Washing Machine", icon: "washing-machine" },
  { key: "heating", label: "Geyser", icon: "shower-head" },
  { key: "refrigerator", label: "Refrigerator", icon: "refrigerator" },
  { key: "stove", label: "Stove", icon: "cooking-pot" },
  { key: "induction", label: "Induction", icon: "zap" },
  { key: "oven", label: "Oven", icon: "microwave" },
  { key: "utensils", label: "Utensils", icon: "utensils" },
  { key: "basic_spices", label: "Basic spices", icon: "soup" },
  { key: "toilet_essentials", label: "Toilet essentials", icon: "bath" },
  { key: "towels", label: "Towels", icon: "bath" },
  { key: "body_soap", label: "Body soap", icon: "droplets" },
  { key: "hangers", label: "Hangers", icon: "shirt" },
  { key: "pets", label: "Pets allowed", icon: "paw-print" },
];

for (const a of AMENITIES) {
  await prisma.amenity.upsert({
    where: { key: a.key },
    update: { label: a.label, icon: a.icon },
    create: a,
  });
}
console.log(`Upserted ${AMENITIES.length} amenities (renamed Heating->Geyser, Washer->Washing Machine).`);

// Remove the old "kitchen" amenity and any listing links to it.
const kitchen = await prisma.amenity.findUnique({ where: { key: "kitchen" } });
if (kitchen) {
  const links = await prisma.listingAmenity.deleteMany({ where: { amenityId: kitchen.id } });
  await prisma.amenity.delete({ where: { id: kitchen.id } });
  console.log(`Removed "kitchen" (and ${links.count} listing link(s)).`);
} else {
  console.log('"kitchen" already absent.');
}
await prisma.$disconnect();
