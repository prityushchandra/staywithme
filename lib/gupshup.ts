// Gupshup WhatsApp transport — the India-based production alternative to Twilio.
//
// Two differences from Twilio that shape this file:
//  1. Send is a plain REST call (apikey header, form-encoded body) to the v1 API.
//  2. Inbound arrives as JSON on the webhook and there is NO synchronous reply
//     (no TwiML). You reply by calling the send API again. So the webhook route
//     parses with parseGupshupInbound() then calls sendWhatsAppGupshup().
//
// Config-driven: when the GUPSHUP_* env vars are set it sends real messages;
// otherwise it logs to the console so the app still runs in dev.

const API_KEY = process.env.GUPSHUP_API_KEY;
const APP_NAME = process.env.GUPSHUP_APP_NAME; // the "src.name" / app name in Gupshup
const SOURCE = process.env.GUPSHUP_SOURCE; // the registered WhatsApp number (digits)

const SEND_URL = "https://api.gupshup.io/wa/api/v1/msg";
const TEMPLATE_URL = "https://api.gupshup.io/wa/api/v1/template/msg";

const digits = (s: string) => s.replace(/\D/g, "");

export function isGupshupConfigured(): boolean {
  return !!(API_KEY && APP_NAME && SOURCE);
}

// Approved template ids, by purpose. Set each as an env var once the template is
// approved in Gupshup; until then that message falls back to a freeform send.
export type TemplateKey =
  | "otp"
  | "bookingGuest"
  | "bookingHost"
  | "reminderGuest"
  | "reminderHost"
  | "cancelGuest"
  | "cancelHost";

export function gupshupTemplateId(key: TemplateKey): string | undefined {
  const env: Record<TemplateKey, string | undefined> = {
    otp: process.env.GUPSHUP_TPL_OTP,
    bookingGuest: process.env.GUPSHUP_TPL_BOOKING_GUEST,
    bookingHost: process.env.GUPSHUP_TPL_BOOKING_HOST,
    reminderGuest: process.env.GUPSHUP_TPL_REMINDER_GUEST,
    reminderHost: process.env.GUPSHUP_TPL_REMINDER_HOST,
    cancelGuest: process.env.GUPSHUP_TPL_CANCEL_GUEST,
    cancelHost: process.env.GUPSHUP_TPL_CANCEL_HOST,
  };
  return env[key];
}

// Send an APPROVED template message. Unlike a freeform send, an approved template
// is delivered to ANY number (no opt-in / 24h window needed) — which is exactly
// what OTP login needs, since first-time users have never messaged us. `params`
// fill the template's {{1}}, {{2}}… placeholders in order.
export async function sendTemplateGupshup(
  toE164: string,
  templateId: string,
  params: string[]
): Promise<{ ok: boolean; sid?: string }> {
  if (!isGupshupConfigured()) {
    console.log(`[gupshup] (dev — not configured) template ${templateId} → ${toE164}: ${params.join(", ")}`);
    return { ok: false };
  }
  const form = new URLSearchParams({
    channel: "whatsapp",
    source: digits(SOURCE!),
    destination: digits(toE164),
    "src.name": APP_NAME!,
    template: JSON.stringify({ id: templateId, params }),
  });
  try {
    const res = await fetch(TEMPLATE_URL, {
      method: "POST",
      headers: { apikey: API_KEY!, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      console.error(`[gupshup] template send failed (${res.status}): ${await res.text().catch(() => "")}`);
      return { ok: false };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, sid: data.messageId };
  } catch (e) {
    console.error("[gupshup] template send error", e);
    return { ok: false };
  }
}

/** Send a freeform WhatsApp text to an E.164 number (e.g. "+9198…"). */
export async function sendWhatsAppGupshup(
  toE164: string,
  body: string
): Promise<{ ok: boolean; sid?: string }> {
  if (!isGupshupConfigured()) {
    console.log(`[gupshup] (dev — not configured) → ${toE164}\n${body}\n`);
    return { ok: false };
  }

  const form = new URLSearchParams({
    channel: "whatsapp",
    source: digits(SOURCE!),
    destination: digits(toE164),
    "src.name": APP_NAME!,
    message: JSON.stringify({ type: "text", text: body }),
  });

  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { apikey: API_KEY!, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      console.error(`[gupshup] send failed (${res.status}): ${await res.text().catch(() => "")}`);
      return { ok: false };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, sid: data.messageId };
  } catch (e) {
    console.error("[gupshup] send error", e);
    return { ok: false };
  }
}

// Gupshup posts BOTH inbound user messages and delivery/status events to the
// same callback URL. We only act on inbound text; everything else returns null
// and the webhook just acks it.
//
// Two payload shapes exist depending on the Gupshup account type:
//  1. Meta WhatsApp Cloud API passthrough (what this account sends):
//       { entry:[{ changes:[{ value:{ messages:[{ from, text:{body} }] } }] }] }
//  2. Legacy Gupshup v2:
//       { type:"message", payload:{ sender:{phone}, payload:{text} } }
// We handle both.
interface MetaCloudWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }>;
      };
    }>;
  }>;
}
interface GupshupLegacyWebhook {
  type?: string;
  payload?: {
    sender?: { phone?: string };
    payload?: { text?: string; title?: string };
  };
}

export function parseGupshupInbound(json: unknown): { from: string; body: string } | null {
  // Meta Cloud API passthrough format.
  const msg = (json as MetaCloudWebhook).entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.from) {
    const body =
      msg.text?.body ??
      msg.button?.text ??
      msg.interactive?.button_reply?.title ??
      msg.interactive?.list_reply?.title;
    return body ? { from: `+${digits(String(msg.from))}`, body: String(body) } : null;
  }

  // Legacy Gupshup v2 format.
  const legacy = json as GupshupLegacyWebhook;
  if (legacy.type === "message") {
    const phone = legacy.payload?.sender?.phone;
    const text = legacy.payload?.payload?.text ?? legacy.payload?.payload?.title;
    if (phone && text) return { from: `+${digits(String(phone))}`, body: String(text) };
  }

  return null;
}
