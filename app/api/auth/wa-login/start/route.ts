import { NextResponse } from "next/server";
import { startWaLogin } from "@/lib/wa-login";
import { getPlatformSettings } from "@/lib/settings";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp";

// Begin a WhatsApp tap-to-verify login. Returns the browser's secret token (to
// poll/complete with), the short code, and a wa.me deep link pre-filled with the
// message the user sends to the business number from their own WhatsApp.
export async function POST() {
  const { token, code } = await startWaLogin();
  const settings = await getPlatformSettings();
  const number = normalizeWhatsAppNumber(settings.whatsappNumber);
  const message = `Verify my StayWithMe login: ${code}`;
  const waLink = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  return NextResponse.json({ token, code, waLink });
}
