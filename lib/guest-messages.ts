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

export function buildGuestMessages(
  guestName: string | null,
  listing: GuestMessageListing,
  onboardingDoorPin?: string,
) {
  const firstName = guestName?.trim().split(/\s+/)[0] || "there";
  const checkOutTime = listing.checkOutTime?.trim() || "10:00 AM";
  const flat = listing.flatNumber?.trim().toUpperCase();
  const flatParts = flat?.match(/^([A-Z]+)?(\d+)$/);
  // The flat prefix is the tower; the saved block may be a building name.
  const tower = flatParts?.[1] || listing.block?.trim()
    .replace(/^(?:tower|block)\s+|\s+(?:tower|block)$/gi, "").trim();
  const pin = onboardingDoorPin?.trim();
  const onboard = flatParts && tower && listing.wifiPassword?.trim() && pin ? [
    `Flat: ${flat}, ${tower} tower`,
    `ssid: Airtel_${flatParts[2]}`,
    `pswd: ${listing.wifiPassword}`,
    `door pin: ${pin}`,
    "The flat is ready for checkin !",
    "Location: https://maps.app.goo.gl/GU1rU9Da7JbWe2227?g_st=ic",
    `For visitor parking , you can ask guard at ${tower} tower , he will guide you`,
  ].join("\n\n") : null;

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
