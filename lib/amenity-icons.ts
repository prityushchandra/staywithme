// Icon keys an amenity can use. These MUST match the keys in the ICONS map in
// components/amenities-list.tsx (that map renders them); an unknown key falls
// back to a generic check mark. Used by the admin "add amenity" picker.
export const AMENITY_ICON_KEYS = [
  "wifi",
  "utensils",
  "car",
  "waves",
  "snowflake",
  "washing-machine",
  "tv",
  "laptop",
  "flame",
  "paw-print",
  "fan",
  "plug-zap",
  "dumbbell",
  "shower-head",
  "refrigerator",
  "cooking-pot",
  "zap",
  "microwave",
  "soup",
  "bath",
  "droplets",
  "shirt",
] as const;

/** Slugify a label into a stable amenity key, e.g. "Hot Water" -> "hot-water". */
export function toAmenityKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
