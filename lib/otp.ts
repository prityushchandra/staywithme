// Phone OTP: normalization, generation, delivery (WhatsApp Cloud API with a
// dev fallback), and the verify/consume lifecycle. All DB-backed via OtpCode.
// Runs on Node (uses prisma + crypto), never the Edge.

import { randomInt } from "crypto";
import { prisma } from "./db";
import { isWhatsAppConfigured, sendOtp } from "./wa-send";

export const OTP_TTL_MIN = 10; // a freshly-sent code is valid this long
const RESEND_COOLDOWN_SEC = 30; // min gap between sends to one number
const MAX_VERIFY_ATTEMPTS = 5; // wrong-code guesses before a code is dead
const VERIFIED_WINDOW_MIN = 10; // how long a verified code can back a sign-in

// Normalize user input to E.164. Bare 10-digit numbers default to India (+91),
// matching the marketplace's audience. Returns null if it doesn't look valid.
export function normalizePhone(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/\D/g, "");
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`; // local Indian number
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// Pretty form for display, e.g. "+91 98765 43210".
export function formatPhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

export function isOtpDeliveryConfigured(): boolean {
  return isWhatsAppConfigured();
}

function generateCode(): string {
  return String(randomInt(100000, 1000000)); // always 6 digits
}

// Send the code over WhatsApp (Twilio). When Twilio isn't configured we fall
// back to logging it and returning it so the verify screen can show it in dev.
async function deliver(
  phone: string,
  code: string
): Promise<{ delivered: boolean; devCode?: string }> {
  if (!isWhatsAppConfigured()) {
    console.log(`[otp] (dev — WhatsApp not configured) code for ${phone}: ${code}`);
    return { delivered: false, devCode: code };
  }
  const r = await sendOtp(
    phone,
    code,
    `Your StayWithMe coupon code is ${code}. Thank you for choosing StayWithMe.`
  );
  // TESTING ONLY: surfaces the code on the verify screen so login can be
  // validated for any number before the OTP template is approved. Hard-gated to
  // non-production so a stray env var can NEVER leak codes (and account takeover)
  // in a deployed app, regardless of OTP_REVEAL_CODE.
  if (process.env.OTP_REVEAL_CODE === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[otp] (reveal mode) code for ${phone}: ${code}`);
    return { delivered: r.ok, devCode: code };
  }
  return { delivered: r.ok };
}

type StartResult =
  | { ok: true; delivered: boolean; devCode?: string }
  | { ok: false; error: string };

// Create + send a fresh code for a phone, replacing any previous one. Enforces
// a short resend cooldown so the endpoint can't be used to spam a number.
export async function startOtp(phone: string): Promise<StartResult> {
  const recent = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    const ageSec = (Date.now() - recent.createdAt.getTime()) / 1000;
    if (ageSec < RESEND_COOLDOWN_SEC) {
      return { ok: false, error: `Please wait a few seconds before requesting another code.` };
    }
  }

  await prisma.otpCode.deleteMany({ where: { phone } });

  const code = generateCode();
  await prisma.otpCode.create({
    data: { phone, code, expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) },
  });

  const { delivered, devCode } = await deliver(phone, code);
  return { ok: true, delivered, devCode };
}

type VerifyResult = "ok" | "invalid" | "expired" | "too_many";

// Check a submitted code. On success stamps verifiedAt (so a later sign-in can
// trust it). Counts wrong guesses and kills the code after too many.
export async function verifyOtp(phone: string, code: string): Promise<VerifyResult> {
  const row = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return "invalid";
  if (row.expiresAt.getTime() < Date.now()) return "expired";
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) return "too_many";

  if (row.code !== code.trim()) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return "invalid";
  }

  await prisma.otpCode.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
  return "ok";
}

// True if the phone has a verified, unconsumed code within the trust window.
// Used by the signup-completion route before creating the account.
export async function hasVerifiedOtp(phone: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null, verifiedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!row?.verifiedAt) return false;
  return Date.now() - row.verifiedAt.getTime() < VERIFIED_WINDOW_MIN * 60_000;
}

// Single-use: consume a verified code to back a sign-in. Returns true once,
// then the code is marked spent. Used by the phone credentials provider.
export async function consumeVerifiedOtp(phone: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null, verifiedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!row?.verifiedAt) return false;
  if (Date.now() - row.verifiedAt.getTime() >= VERIFIED_WINDOW_MIN * 60_000) return false;

  // Atomic single-use: only the first caller whose conditional update still sees
  // consumedAt === null wins, so a code can never back two concurrent sign-ins.
  const res = await prisma.otpCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return res.count === 1;
}
