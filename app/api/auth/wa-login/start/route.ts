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
export async function POST(req: Request) {
  // The number typed on the sign-in screen. Recorded so the webhook can refuse a
  // code sent from a different WhatsApp account; it is only ever an equality
  // constraint, so it can never grant access to a number the sender can't prove.
  let claimedPhone: string | null = null;
  try {
    const body = (await req.json()) as { phone?: unknown };
    if (typeof body?.phone === "string") claimedPhone = body.phone;
  } catch {
    // No/!JSON body — fall back to binding the login to whoever sends the code.
  }

  const { token, code } = await startWaLogin(claimedPhone);
  const settings = await getPlatformSettings();
  const botNumber = process.env.GUPSHUP_SOURCE || settings.whatsappNumber;
  const number = normalizeWhatsAppNumber(botNumber);
  const message = `Verify my StayWithMe login: ${code}`;
  const waLink = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  // `message` + `botNumber` let the UI offer a copy/paste fallback when the deep
  // link can't open WhatsApp (desktop without the app, in-app browsers, …).
  return NextResponse.json({ token, code, message, waLink, botNumber: botNumber || null });
}
