// Unified WhatsApp send — picks the provider from WHATSAPP_PROVIDER so the rest
// of the app (OTP, booking notifications, bot replies) stays provider-agnostic.
// Default is "twilio" (incl. the sandbox); set WHATSAPP_PROVIDER=gupshup to move
// the production sender to Gupshup with no other code changes.

import { isWhatsAppConfigured as twilioConfigured, sendWhatsApp as sendTwilio } from "./twilio";
import {
  isGupshupConfigured,
  sendWhatsAppGupshup,
  sendTemplateGupshup,
  gupshupTemplateId,
  type TemplateKey,
} from "./gupshup";

export type WhatsAppProvider = "twilio" | "gupshup";

export function whatsappProvider(): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER === "gupshup" ? "gupshup" : "twilio";
}

export function isWhatsAppConfigured(): boolean {
  return whatsappProvider() === "gupshup" ? isGupshupConfigured() : twilioConfigured();
}

export function sendWhatsApp(
  toE164: string,
  body: string
): Promise<{ ok: boolean; sid?: string }> {
  return whatsappProvider() === "gupshup"
    ? sendWhatsAppGupshup(toE164, body)
    : sendTwilio(toE164, body);
}

// Send a business-initiated notification. WhatsApp blocks freeform messages to
// anyone without an open 24h session, so when an approved template is configured
// (Gupshup) we send via template — that reaches ANY number. Until the template
// is approved + its id set, we fall back to freeform (sandbox / opted-in only).
// `params` MUST match the template's {{1}}, {{2}}… in order.
export function sendNotification(
  toE164: string,
  templateKey: TemplateKey,
  params: string[],
  fallbackBody: string
): Promise<{ ok: boolean; sid?: string }> {
  if (whatsappProvider() === "gupshup") {
    const templateId = gupshupTemplateId(templateKey);
    if (templateId) return sendTemplateGupshup(toE164, templateId, params);
  }
  return sendWhatsApp(toE164, fallbackBody);
}

// OTP is just a notification with the "otp" template and the code as its param.
export function sendOtp(
  toE164: string,
  code: string,
  fallbackBody: string
): Promise<{ ok: boolean; sid?: string }> {
  return sendNotification(toE164, "otp", [code], fallbackBody);
}
