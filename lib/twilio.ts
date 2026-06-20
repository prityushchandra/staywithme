// Twilio WhatsApp transport — one sender for OTP codes, booking notifications,
// and bot replies. Config-driven: when the TWILIO_* env vars are set it sends
// real WhatsApp messages (Twilio Sandbox while testing, a production sender
// later); otherwise it logs to the server console so the whole app works in
// dev with no account. Runs on Node only.

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
// e.g. the sandbox "whatsapp:+14155238886", or your production sender.
const FROM = process.env.TWILIO_WHATSAPP_FROM;

export function isWhatsAppConfigured(): boolean {
  return !!(SID && TOKEN && FROM);
}

/** Send a freeform WhatsApp message to an E.164 number (e.g. "+9198…"). */
export async function sendWhatsApp(
  toE164: string,
  body: string
): Promise<{ ok: boolean; sid?: string }> {
  const to = toE164.startsWith("whatsapp:") ? toE164 : `whatsapp:${toE164}`;

  if (!isWhatsAppConfigured()) {
    console.log(`[whatsapp] (dev — Twilio not configured) → ${to}\n${body}\n`);
    return { ok: false };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: FROM!, To: to, Body: body }).toString(),
      }
    );
    if (!res.ok) {
      console.error(
        `[whatsapp] send failed (${res.status}): ${await res.text().catch(() => "")}`
      );
      return { ok: false };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error("[whatsapp] send error", e);
    return { ok: false };
  }
}

// Twilio posts inbound WhatsApp messages as form-encoded webhooks. `From` looks
// like "whatsapp:+9198…".
export type InboundMessage = { from: string; body: string };

export function parseInboundForm(form: URLSearchParams): InboundMessage {
  const from = (form.get("From") ?? "").replace(/^whatsapp:/, "").trim();
  const body = (form.get("Body") ?? "").trim();
  return { from, body };
}

/** Build the TwiML a Twilio WhatsApp webhook expects for a reply (or empty). */
export function twiml(reply?: string): string {
  if (!reply) return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  const escaped = reply
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
