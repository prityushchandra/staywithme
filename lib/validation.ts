import { z } from "zod";

// A Property ID (Listing.refCode) is the short code a guest quotes over
// WhatsApp, e.g. "HAXGT". Stored uppercase: the bot looks it up
// case-insensitively, so two codes differing only in case must not coexist.
export const PROPERTY_ID_RE = /^[A-Z0-9]{3,12}$/;
export const PROPERTY_ID_MAX = 12;

/**
 * Cap for a stored Google Maps link. A share link looks short when pasted, but
 * `expandMapsShortLink` resolves it to Google's canonical URL, which carries
 * `lucs`/`g_ep` tracking blobs and routinely runs past 600 characters. Capping
 * near the input length made a listing uneditable the moment its link expanded
 * past the limit, so the ceiling is the conventional safe URL length instead.
 */
export const MAPS_URL_MAX = 2000;

/** True when `value` is a plausible http(s) URL (used for the Maps link). */
export function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname.includes(".")
  );
}

/**
 * True when a Prisma write failed because Listing.refCode was already taken.
 * Checking the reported target avoids swallowing a P2002 raised by a different
 * unique constraint in the same transaction.
 */
export function isDuplicateRefCodeError(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  // No target reported means we cannot tell which constraint tripped; refCode
  // is the only unique column a listing write sets, so assume it was ours.
  return fields.length === 0 || fields.some((f) => f.includes("refCode"));
}

// Shared listing input schema (client form + server API use the same rules).
// Note: there is intentionally NO contact/phone field — inquiry routing is global.
export const listingInputSchema = z
  .object({
  title: z.string().min(5, "Give your listing a descriptive title").max(100),
  description: z.string().min(20, "Add at least a couple of sentences").max(4000),
  // Optional public host name shown as "Hosted by …".
  hostDisplayName: z.string().trim().max(50).optional(),
  // Optional Property ID. Blank means "generate one" on create, or "keep the
  // existing one" on edit — the server never clears a code that's in use.
  refCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (s) => s === "" || PROPERTY_ID_RE.test(s),
      "Property ID must be 3–12 letters or numbers, e.g. HAXGT"
    )
    .optional(),
  // Optional Google Maps share link. Public — shown to guests.
  mapsUrl: z
    .string()
    .trim()
    .max(MAPS_URL_MAX, "That Google Maps link is too long — re-copy it from the Share menu")
    .refine(
      (s) => s === "" || isHttpUrl(s),
      "Enter a valid Google Maps link starting with http:// or https://"
    )
    .optional(),
  // Admin-only curation flag. A host may submit it, but the API ignores the
  // value unless the caller is an admin — never trust this from the client.
  guestFavorite: z.boolean().default(false),
  propertyType: z.enum([
    "APARTMENT",
    "HOUSE",
    "VILLA",
    "CABIN",
    "COTTAGE",
    "LOFT",
    "GUESTHOUSE",
  ]),
  roomType: z.enum(["ENTIRE", "PRIVATE", "SHARED"]),
  addressLine: z.string().min(3).max(200),
  city: z.string().min(2).max(100),
  country: z.string().min(2).max(100),
  // Confidential exact location — required from the host, never shown to guests.
  // Format: one letter (A–Z) followed by exactly 4 digits, e.g. "L1234".
  // Normalised to uppercase so "l1234" is accepted and stored as "L1234".
  flatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{4}$/, "Flat number must be a letter followed by 4 digits, e.g. L1234"),
  block: z.string().trim().min(1, "Enter the block / tower").max(40),
  bedrooms: z.coerce.number().int().min(1).max(4),
  bathrooms: z.coerce.number().int().min(1).max(4),
  beds: z.coerce.number().int().min(1).max(4),
  maxGuests: z.coerce.number().int().min(1).max(20),
  maxInfants: z.coerce.number().int().min(0).max(10).default(0),
  // basePrice is entered in RUPEES in the form, converted to paise server-side.
  basePriceRupees: z.coerce.number().int().min(1, "Enter a price").max(10_000_000),
  // Optional sale price (rupees); 0/empty = no discount. Must undercut the base
  // price, which is the only thing that makes the struck-through price honest.
  discountedPriceRupees: z.coerce.number().int().min(0).max(10_000_000).default(0),
  // Optional monthly rate (rupees); 0/empty = not offered. Applies to 30+ night stays.
  monthlyPriceRupees: z.coerce.number().int().min(0).max(100_000_000).default(0),
  cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"]),
  // Host-set "things to know" details (all optional).
  checkInTime: z.string().trim().max(40).optional(),
  checkOutTime: z.string().trim().max(40).optional(),
  houseRules: z.string().trim().max(2000).optional(),
  // WiFi shown on booking receipts only (never on the public listing page).
  wifiName: z.string().trim().max(80).optional(),
  wifiPassword: z.string().trim().max(80).optional(),
  amenityKeys: z.array(z.string()).default([]),
  imageUrls: z
    .array(
      z
        .string()
        .refine(
          (s) => /^https?:\/\//.test(s) || s.startsWith("data:image/"),
          "Each photo must be an image URL or an uploaded image"
        )
    )
    .min(1, "Add at least one photo")
    .max(40, "You can add up to 40 photos"),
  })
  .superRefine((v, ctx) => {
    // A "discount" at or above the list price would render as a strike-through
    // saving that isn't one, so reject it rather than quietly ignoring it.
    if (v.discountedPriceRupees > 0 && v.discountedPriceRupees >= v.basePriceRupees) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountedPriceRupees"],
        message: "The discounted price must be lower than the base price",
      });
    }
  });

export type ListingInput = z.infer<typeof listingInputSchema>;

// Shared review input schema (client form + server API use the same rules).
export const reviewInputSchema = z.object({
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  body: z
    .string()
    .min(10, "Add a sentence or two about your stay")
    .max(2000),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

// --- Phone OTP auth ---
export const phoneStartSchema = z.object({
  phone: z.string().min(6, "Enter your mobile number").max(20),
});

export const otpVerifySchema = z.object({
  phone: z.string().min(6).max(20),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit coupon code"),
});

export const signupCompleteSchema = z.object({
  phone: z.string().min(6).max(20),
  firstName: z.string().trim().min(1, "Enter your first name").max(50),
  lastName: z.string().trim().min(1, "Enter your last name").max(50),
});

// Profile self-edit (name).
export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(50),
  lastName: z.string().trim().min(1, "Enter your last name").max(50),
});
