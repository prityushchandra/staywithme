import { NextResponse } from "next/server";
import { startWaLogin } from "@/lib/wa-login";
import { getPlatformSettings } from "@/lib/settings";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp";

// Begin a WhatsApp tap-to-verify login. Returns the browser's secret token (to
// poll/complete with), the short code, and a wa.me deep link pre-filled with the
// message the user sends from their own WhatsApp.
//
// IMPORTANT: the link must target the number our WEBHOOK is connected to (the
// Gupshup business number), NOT the public inquiry contact in PlatformSettings —
// otherwise the verification message never reaches the bot. Falls back to the
// settings number only when the Gupshup source isn't configured (dev/Twilio).
export async function POST() {
  const { token, code } = await startWaLogin();
  const settings = await getPlatformSettings();
  const botNumber = process.env.GUPSHUP_SOURCE || settings.whatsappNumber;
  const number = normalizeWhatsAppNumber(botNumber);
  const message = `Verify my StayWithMe login: ${code}`;
  const waLink = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  return NextResponse.json({ token, code, waLink });
}
