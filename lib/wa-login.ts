// WhatsApp "tap-to-verify" login core. Runs on Node (prisma + crypto).
//
// Flow:
//  1. startWaLogin()  — browser gets a secret `token` (to poll/complete with) and
//     a short human `code` to send over WhatsApp, plus the number the user typed.
//  2. verifyWaLogin(code, senderPhone) — the webhook calls this when a message
//     with that code arrives. The account is bound to the VERIFIED SENDER phone,
//     which WhatsApp authenticates and cannot be spoofed. If that sender isn't
//     the number typed in the browser, the request is REJECTED.
//  3. waLoginStatus(token) — the browser polls this until "verified".
//  4. consumeWaLogin(token) — the "wa" credentials provider calls this once to
//     mint the session; single-use so a token can never back two sign-ins.
//
// Security note: the only way to log in as a given account is to send the code
// from THAT account's WhatsApp number — same possession guarantee as an OTP,
// just proven by sending instead of receiving. The token is the browser's
// secret and is never placed in the WhatsApp message.

import { randomBytes, randomInt } from "crypto";
import { prisma } from "./db";
import { normalizePhone } from "./otp";

const TTL_MIN = 5; // a login request is valid this long
const CODE_LEN = 6;
// Unambiguous alphabet — no 0/O/1/I so the code is easy to read and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return s;
}

/**
 * Begin a login: returns the browser's secret token + the short code to send.
 *
 * `claimedPhone` is the number typed on the sign-in screen. It is recorded so
 * verifyWaLogin() can refuse a code sent from a different WhatsApp account — it
 * is only ever an equality constraint, never a grant of access.
 */
export async function startWaLogin(
  claimedPhone?: string | null
): Promise<{ token: string; code: string }> {
  // Opportunistic cleanup of stale rows.
  await prisma.whatsAppLogin.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const token = randomBytes(32).toString("hex");
  // Ensure the code is unique among currently-active requests so the webhook can
  // resolve it unambiguously.
  let code = makeCode();
  for (let i = 0; i < 6; i++) {
    const clash = await prisma.whatsAppLogin.findFirst({
      where: { code, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!clash) break;
    code = makeCode();
  }

  await prisma.whatsAppLogin.create({
    data: {
      token,
      code,
      // Store it normalized so the webhook compares like with like. An
      // unparseable number is stored as null, which keeps the old
      // bind-to-whoever-sends behaviour rather than failing the login outright.
      claimedPhone: claimedPhone ? normalizePhone(claimedPhone) : null,
      expiresAt: new Date(Date.now() + TTL_MIN * 60_000),
    },
  });
  return { token, code };
}

/**
 * Does the WhatsApp sender match the number typed in the browser? The sender is
 * authenticated by WhatsApp; the claim is merely typed, so this is a constraint
 * on an already-proven identity and never a way to assert one.
 *
 * No claim recorded → true, so a login started without a declared number still
 * binds to whoever sends the code.
 */
export function senderMatchesClaim(claimedPhone: string | null, senderPhone: string): boolean {
  if (!claimedPhone) return true;
  const claim = normalizePhone(claimedPhone);
  if (!claim) return true;
  return claim === normalizePhone(senderPhone);
}

export type WaVerifyResult = { ok: true } | { ok: false; reason: "unknown" | "mismatch" };

/**
 * Mark a login VERIFIED for the WhatsApp message's verified sender. The phone is
 * taken ONLY from the authenticated sender — never from client input.
 *
 * Returns a reason on failure so the bot can tell the sender what actually went
 * wrong: a code sent from the wrong number is a different problem from an
 * expired one, and used to be reported as success.
 */
export async function verifyWaLogin(code: string, senderPhone: string): Promise<WaVerifyResult> {
  const row = await prisma.whatsAppLogin.findFirst({
    where: { code: code.trim().toUpperCase(), status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, reason: "unknown" };

  // Wrong sender: this code belongs to somebody else's sign-in. Reject the
  // request outright so the browser stops polling and reports the same failure
  // the sender just saw, instead of spinning until the TTL runs out.
  if (!senderMatchesClaim(row.claimedPhone, senderPhone)) {
    await prisma.whatsAppLogin.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "REJECTED" },
    });
    return { ok: false, reason: "mismatch" };
  }

  // Atomic: only the first caller that still sees PENDING wins.
  const res = await prisma.whatsAppLogin.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "VERIFIED", phone: senderPhone, verifiedAt: new Date() },
  });
  return res.count === 1 ? { ok: true } : { ok: false, reason: "unknown" };
}

export type WaLoginStatus = "pending" | "verified" | "expired" | "rejected" | "unknown";

/**
 * Poll a login by its token. Returns the status and, once verified, whether the
 * sender is a brand-new user (so the UI can collect their name). No phone is ever
 * returned to the client — only this boolean, and only to the token holder.
 */
export async function waLoginInfo(
  token: string
): Promise<{ status: WaLoginStatus; needsProfile: boolean }> {
  const row = await prisma.whatsAppLogin.findUnique({ where: { token } });
  if (!row) return { status: "unknown", needsProfile: false };

  let status: WaLoginStatus;
  if (row.status === "VERIFIED" || row.status === "CONSUMED") status = "verified";
  // Checked before expiry so a wrong-number rejection is still reported as such
  // even if the user comes back after the TTL has lapsed.
  else if (row.status === "REJECTED") status = "rejected";
  else if (row.expiresAt.getTime() < Date.now()) status = "expired";
  else status = "pending";

  let needsProfile = false;
  if (status === "verified" && row.phone) {
    const user = await prisma.user.findUnique({
      where: { phone: row.phone },
      select: { id: true },
    });
    needsProfile = !user; // first-ever login for this number
  }
  return { status, needsProfile };
}

/**
 * Single-use consume for the "wa" credentials provider. Returns the VERIFIED
 * sender phone exactly once, then the request can never mint another session.
 */
export async function consumeWaLogin(token: string): Promise<string | null> {
  const row = await prisma.whatsAppLogin.findUnique({ where: { token } });
  if (!row || row.status !== "VERIFIED" || !row.phone) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  const res = await prisma.whatsAppLogin.updateMany({
    where: { id: row.id, status: "VERIFIED" },
    data: { status: "CONSUMED" },
  });
  return res.count === 1 ? row.phone : null;
}

/** Extract a login code from an inbound WhatsApp message, if present. */
export function parseWaLoginCode(text: string): string | null {
  const m = /StayWithMe login[:\s-]+([A-Za-z0-9]{6})/i.exec(text);
  return m ? m[1].toUpperCase() : null;
}
