import { z } from "zod";

// Shared listing input schema (client form + server API use the same rules).
// Note: there is intentionally NO contact/phone field — inquiry routing is global.
export const listingInputSchema = z.object({
  title: z.string().min(5, "Give your listing a descriptive title").max(40),
  description: z.string().min(20, "Add at least a couple of sentences").max(4000),
  // Optional public host name shown as "Hosted by …".
  hostDisplayName: z.string().trim().max(50).optional(),
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
  // Optional monthly rate (rupees); 0/empty = not offered. Applies to 30+ night stays.
  monthlyPriceRupees: z.coerce.number().int().min(0).max(100_000_000).default(0),
  cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"]),
  // Host-set "things to know" details (all optional).
  checkInTime: z.string().trim().max(40).optional(),
  checkOutTime: z.string().trim().max(40).optional(),
  houseRules: z.string().trim().max(2000).optional(),
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
