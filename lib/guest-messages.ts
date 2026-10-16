import { mapsViewHref } from "./maps";
import { normalizeWhatsAppNumber } from "./whatsapp";

export type GuestMessageListing = {
  title: string;
  flatNumber: string | null;
  block: string | null;
  addressLine: string;
  city: string;
  country: string;
  mapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
};

export function guestPhoneDigits(phone: string | null): string | null {
  if (!phone) return null;
  let digits = normalizeWhatsAppNumber(phone);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function guestWhatsAppHref(phone: string | null, message: string): string | null {
  const digits = guestPhoneDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

export function buildGuestMessages(guestName: string | null, listing: GuestMessageListing) {
  const firstName = guestName?.trim().split(/\s+/)[0] || "there";
  const checkInTime = listing.checkInTime?.trim() || "2:00 PM";
  const checkOutTime = listing.checkOutTime?.trim() || "10:00 AM";
  const address = [listing.addressLine, listing.city, listing.country].filter(Boolean).join(", ");
  const maps = mapsViewHref({ ...listing, address })
    ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const block = listing.block?.trim();
  const tower = block
    ? /^(tower|block)\b/i.test(block) ? block : `Tower ${block}`
    : "";
  const flat = listing.flatNumber?.trim() ? `flat ${listing.flatNumber.trim()}` : listing.title;
  const destination = [tower, flat].filter(Boolean).join(", ");
  const wifi = [
    "- WiFi Details",
    listing.wifiName?.trim() ? `- Network: ${listing.wifiName.trim()}` : "",
    listing.wifiPassword ? `- Password: ${listing.wifiPassword}` : "",
  ].filter(Boolean);

  const onboard = [
    `Hi ${firstName},`,
    "",
    "We're super excited to host you!",
    "",
    `- Check-in: ${checkInTime}`,
    `- Check-out: ${checkOutTime}`,
    "",
    `- Location: ${maps}`,
    "",
    `- Once you reach ${listing.addressLine || listing.title}, come to ${destination} and call me. I will share the door PIN. Give your name and contact to the security guard if asked at the main gate; the request will be auto approved.`,
    "",
    "- All Swiggy/Zomato/Blinkit requests are auto approved and will be delivered to your doorstep.",
    "",
    ...(wifi.length > 1 ? [...wifi, ""] : []),
    "- Amenities (8am-8pm)",
    "- Pool: There are two swimming pools; one is in front of G tower.",
    "- Gym: Club house 1, 2nd floor.",
    "",
    "- Access Information",
    "- Smart door lock PIN will be shared before check-in.",
    "- All kitchen utensils and cutlery are kept in the kitchen drawers.",
    "",
    "To ensure a comfortable and pleasant stay for everyone, we kindly request you to follow a few house guidelines:",
    "",
    "- Smoking inside the apartment is not permitted.",
    "- Parties or loud music are not allowed.",
    "- Only registered guests are allowed inside the property.",
    "- Please switch off lights and gas when stepping out.",
    "- Kindly dispose of garbage in the designated bins.",
    "- Towels are not provided, so we request you to carry your own.",
    "- Personal toiletries (like shampoo, toothbrush, etc.) are not provided, so please bring your essentials.",
    "- A swimming cap is required for using the pool.",
    "",
    "Thank you for your understanding and cooperation.",
    "",
    "Wishing you a relaxing and enjoyable stay with us!!",
  ].join("\n");

  const checkout = [
    `Hi ${firstName},`,
    "",
    `Hope you had a wonderful stay. Just a gentle reminder that the checkout time is ${checkOutTime}.`,
    "",
    "Before leaving, kindly ensure all appliances are switched off and the gas knobs are turned off. We would also appreciate it if the apartment is left in the same condition as you received it, so it is comfortable for the next guest as well.",
    "",
    "Please don't switch off WiFi and the fridge.",
    "",
    "Kindly dispose of all personal waste in the designated bins provided. We appreciate your help in keeping the property clean by avoiding leaving any garbage, food waste, or other items around the space or on surfaces.",
    "",
    "Wishing you a safe and pleasant journey ahead. Thank you again for staying with us, and we hope to host you again soon!!",
  ].join("\n");

  const doorPin = [
    `Hi ${firstName},`,
    "",
    'The flat is ready for check-in. Please cover the door lock with your palm first to wake it up, then ring the doorbell before entering the door PIN, otherwise it might not work. After entering the PIN, press "#" or the tick symbol on the keypad.',
    "",
    "PIN: ",
  ].join("\n");

  return { onboard, checkout, doorPin };
}
