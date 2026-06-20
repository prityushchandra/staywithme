import { NextResponse, after } from "next/server";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clearMemo } from "@/lib/memo";
import { parseInboundForm, twiml } from "@/lib/twilio";
import { parseGupshupInbound } from "@/lib/gupshup";
import { whatsappProvider, sendWhatsApp } from "@/lib/wa-send";
import { normalizePhone } from "@/lib/otp";
import {
  reserveForGuest,
  cancelBooking,
  findListingByRefCode,
  findListingsByUnitBlock,
  unitBlock,
} from "@/lib/bookings";
import { addBlock, toUtcDate } from "@/lib/availability";
import { getPlatformSettings } from "@/lib/settings";
import { formatINR } from "@/lib/pricing";

// WhatsApp bot — ADMIN ONLY. Hosts/guests are pointed back to the admin.
// Reserve = forward the guest's enquiry → "how much received?". Listings are
// identified by unit + block; dates are DD/MM. All reads/writes hit the DB.
export async function POST(req: Request) {
  if (whatsappProvider() === "gupshup") return handleGupshupWebhook(req);

  // ----- Twilio (default): form-encoded in, TwiML reply out -----
  const form = new URLSearchParams(await req.text());

  // Without the signing token + URL we can't prove the request came from Twilio,
  // and handle() trusts the `from` field to grant admin. Fail closed in prod.
  const expectedUrl = process.env.TWILIO_WEBHOOK_URL;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!expectedUrl || !authToken) {
    if (process.env.NODE_ENV === "production") {
      console.error("[twilio webhook] TWILIO_WEBHOOK_URL / TWILIO_AUTH_TOKEN not set — rejecting");
      return new NextResponse("not configured", { status: 503 });
    }
  } else {
    const sig = req.headers.get("x-twilio-signature") ?? "";
    if (!verifyTwilioSignature(expectedUrl, form, sig)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }
  }

  const { from, body } = parseInboundForm(form);
  let reply: string | null;
  try {
    reply = await handle(from, body);
  } catch (e) {
    // On an admin-path error, answer with something rather than a silent 500.
    // (Non-admins return null above and get an empty TwiML = no message.)
    console.error("[whatsapp webhook] handler error", e);
    reply = "Something went wrong on my end. Please send that again in a moment.";
  }
  return new NextResponse(twiml(reply ?? undefined), { headers: { "Content-Type": "text/xml" } });
}

// ----- Gupshup: JSON in, reply by calling the send API (no TwiML) -----
// Gupshup posts inbound messages AND delivery events to this same URL; we ack
// everything with 200 and only act on inbound text. The reply goes out via
// after() so we return the 200 fast and the work survives on serverless.
async function handleGupshupWebhook(req: Request): Promise<NextResponse> {
  // The webhook trusts the inbound `from` to decide who's the admin, so the
  // shared token on the callback URL (?token=…) is the ONLY thing stopping a
  // forged request from driving admin commands. Therefore: require it, fail
  // closed in production if it's not configured, and compare it constant-time.
  const token = process.env.GUPSHUP_WEBHOOK_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      console.error("[gupshup webhook] GUPSHUP_WEBHOOK_TOKEN not set — rejecting");
      return NextResponse.json({ error: "not configured" }, { status: 503 });
    }
  } else {
    const gotToken = new URL(req.url).searchParams.get("token") ?? "";
    if (!safeEqual(gotToken, token)) {
      console.warn("[gupshup webhook] 401 — bad token");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const raw = await req.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // not JSON — ack and ignore
  }

  const inbound = parseGupshupInbound(json);
  if (!inbound) return NextResponse.json({ ok: true }); // delivery event / non-text

  let reply: string | null;
  try {
    reply = await handle(inbound.from, inbound.body);
  } catch (e) {
    console.error("[gupshup webhook] handler error", e);
    reply = "Something went wrong on my end. Please send that again in a moment.";
  }
  // null reply (e.g. a non-admin number) → stay silent, just ack.
  if (reply) {
    const r = reply;
    after(() => sendWhatsApp(inbound.from, r));
  }
  return NextResponse.json({ ok: true });
}

// Constant-time string compare. Hash both sides to a fixed length first so the
// comparison never leaks the secret's length and timingSafeEqual won't throw.
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string) {
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const keys = [...params.keys()].sort();
  const data = url + keys.map((k) => k + params.get(k)).join("");
  const expected = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- dates (DD/MM, year inferred) ----------
function parseDdmm(s: string): Date | null {
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const day = +m[1];
  const month = +m[2];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let year = now.getUTCFullYear();
  let t = Date.UTC(year, month - 1, day);
  if (t < todayUtc) t = Date.UTC(++year, month - 1, day);
  return new Date(t);
}
const fmt = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Parse a forwarded guest enquiry (the message built by lib/whatsapp.ts).
function parseEnquiry(text: string) {
  // Ref is now a short code (e.g. "K7M2Q"); still accept an old long cuid.
  const ref = /Ref:\s*([a-z0-9]{5,})/i.exec(text);
  const ci = /Check[\s-]*in:\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  const co = /Check[\s-]*out:\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (!ref || !ci || !co) return null;
  const ph = /(?:contact|guest|phone|number)\s*[:\-]?\s*(\+?\d[\d\s-]{8,})/i.exec(text);
  return { ref: ref[1], checkIn: ci[1], checkOut: co[1], guestPhone: ph ? normalizePhone(ph[1]) : null };
}

// ---------- conversation state (DB-backed; survives serverless invocations) ----------
// One CONFIRMED booking the admin can choose from when cancelling.
type Candidate = { bookingId: string; unit: string; block: string; guest: string };
type Convo =
  | { kind: "reserveFwd"; step: "enquiry" | "guestPhone" | "amount"; listingId?: string; checkIn?: string; checkOut?: string; guestPhone?: string }
  | { kind: "cancel"; step: "dates" | "pick"; start?: string; end?: string; candidates?: Candidate[] }
  | { kind: "block"; cmd: "block" | "unblock"; step: "dates" | "flat"; start?: string; end?: string }
  | { kind: "unblockConfirm"; bookingId: string; listingId: string; start: string; end: string };

const CONVO_TTL_MS = 15 * 60_000;

async function getConvo(phone: string): Promise<Convo | null> {
  const row = await prisma.botConversation.findUnique({ where: { phone } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.botConversation.deleteMany({ where: { phone } });
    return null;
  }
  return row.state as unknown as Convo;
}
async function setConvo(phone: string, state: Convo): Promise<void> {
  const expiresAt = new Date(Date.now() + CONVO_TTL_MS);
  const json = state as unknown as Prisma.InputJsonValue;
  await prisma.botConversation.upsert({
    where: { phone },
    create: { phone, state: json, expiresAt },
    update: { state: json, expiresAt },
  });
}
async function delConvo(phone: string): Promise<void> {
  await prisma.botConversation.deleteMany({ where: { phone } });
}

const KEYWORDS = [
  "block", "unblock", "reserve", "cancel", "bookings", "pending", "listings",
  "earnings", "help", "hi", "hello", "menu", "start", "stop", "reset", "yes", "no",
];
const ASK_AMOUNT = "How much have you received? (₹ amount, or 0 if nothing yet)";

async function overlappingBookings(listingId: string, start: Date, end: Date) {
  return prisma.booking.findMany({
    where: { listingId, status: "CONFIRMED", checkIn: { lt: end }, checkOut: { gt: start } },
    include: { guest: true },
    orderBy: { checkIn: "asc" },
  });
}
function bookingLines(bs: Awaited<ReturnType<typeof overlappingBookings>>) {
  return bs
    .map((b) => `• ${b.guest.name ?? "—"} (${b.guest.phone ?? "no number"})\n  ${fmt(b.checkIn)} → ${fmt(b.checkOut)} · ${formatINR(b.totalAmount)}`)
    .join("\n");
}

type FlatListing = { id: string; flatNumber: string | null; block: string | null };

// Flexible flat reference, so all of these resolve to the same flat:
//   "L1339 Paradise" · "L1339, Paradise" · "l1339,paradise"
// The flat number is the token shaped like a letter + 4 digits; the rest is the
// block. Block matching against the DB is case-insensitive, so case is ignored.
function parseFlatRef(text: string): { unit: string; block: string } | null {
  const tokens = text.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  const unitIdx = tokens.findIndex((t) => /^[a-z]\d{4}$/i.test(t));
  if (unitIdx === -1) return null;
  const unit = tokens[unitIdx].toUpperCase();
  const block = tokens.filter((_, i) => i !== unitIdx).join(" ").trim();
  return block ? { unit, block } : null;
}

// Resolve a flat reference to exactly one listing, or an error message to reply.
async function resolveFlat(
  unit: string,
  block: string
): Promise<{ listing: FlatListing } | { error: string }> {
  const matches = await findListingsByUnitBlock(unit, block);
  if (!matches.length) return { error: `No flat for ${unit}, ${block}.` };
  if (matches.length > 1) return { error: `More than one flat matches ${unit}, ${block}.` };
  return { listing: matches[0] };
}

// All CONFIRMED bookings overlapping a date range, across every flat.
async function overlappingConfirmed(start: Date, end: Date) {
  return prisma.booking.findMany({
    where: { status: "CONFIRMED", checkIn: { lt: end }, checkOut: { gt: start } },
    include: {
      listing: { select: { flatNumber: true, block: true } },
      guest: { select: { name: true, phone: true } },
    },
    orderBy: { checkIn: "asc" },
  });
}

// Block a flat for a date range (the actual side effect, shared by the one-shot
// command and the guided flow).
async function doBlockDates(listing: FlatListing, start: Date, end: Date): Promise<string> {
  const span = `${fmt(start)} → ${fmt(end)}`;
  const booked = await overlappingBookings(listing.id, start, end);
  if (booked.length)
    return `⚠️ These dates already have a booking on ${unitBlock(listing)}:\n\n${bookingLines(booked)}\n\nNot blocked — cancel the booking first if you really need to.`;
  const r = await addBlock({ listingId: listing.id, startDate: start, endDate: end, kind: "MANUAL", createdById: null });
  revalidateTag("listings");
  clearMemo();
  if (!r.ok) return "Some of those dates are already blocked.";
  return `Blocked ✅\n${unitBlock(listing)}\n${span}`;
}

// Unblock a flat for a date range. If a booking sits on those dates, ask the
// admin to confirm cancelling it (transitions to the unblockConfirm flow).
async function doUnblockDates(listing: FlatListing, start: Date, end: Date, phone: string): Promise<string> {
  const span = `${fmt(start)} → ${fmt(end)}`;
  const booked = await overlappingBookings(listing.id, start, end);
  if (booked.length) {
    await setConvo(phone, { kind: "unblockConfirm", bookingId: booked[0].id, listingId: listing.id, start: ymd(start), end: ymd(end) });
    return `⚠️ These dates have a booking on ${unitBlock(listing)}:\n\n${bookingLines(booked)}\n\nReply YES to cancel it and free the dates (refund applies), or NO to keep it.`;
  }
  const del = await prisma.availabilityBlock.deleteMany({
    where: { listingId: listing.id, startDate: { lt: end }, endDate: { gt: start }, kind: "MANUAL" },
  });
  revalidateTag("listings");
  clearMemo();
  return del.count ? `Unblocked ✅\n${unitBlock(listing)}\n${span}` : `No blocked dates on ${unitBlock(listing)} for ${span}.`;
}

// ---------- reserve (forward enquiry → amount) ----------
async function handleReserveFwd(flow: Extract<Convo, { kind: "reserveFwd" }>, text: string, phone: string): Promise<string> {
  if (flow.step === "enquiry") {
    const parsed = parseEnquiry(text);
    if (!parsed)
      return "I couldn't read that. Forward the guest's enquiry message (the one with Ref, Check-in and Check-out).";
    const listing =
      (await findListingByRefCode(parsed.ref)) ??
      (await prisma.listing.findUnique({ where: { id: parsed.ref } }));
    if (!listing)
      return `I couldn't find a flat for Ref ${parsed.ref}. Double-check the code and forward the enquiry again.`;
    flow.listingId = listing.id;
    flow.checkIn = parsed.checkIn;
    flow.checkOut = parsed.checkOut;
    if (parsed.guestPhone) {
      flow.guestPhone = parsed.guestPhone;
      flow.step = "amount";
      await setConvo(phone, flow);
      return ASK_AMOUNT;
    }
    flow.step = "guestPhone";
    await setConvo(phone, flow);
    return "Guest's WhatsApp number?";
  }
  if (flow.step === "guestPhone") {
    const p = normalizePhone(text);
    if (!p) return "That doesn't look like a valid number. Guest's WhatsApp number?";
    flow.guestPhone = p;
    flow.step = "amount";
    await setConvo(phone, flow);
    return ASK_AMOUNT;
  }
  // amount
  await delConvo(phone);
  const rupees = parseInt((text.match(/\d+/g) || []).join(""), 10) || 0;
  const guest = await prisma.user.findUnique({ where: { phone: flow.guestPhone! } });
  if (!guest) return `No guest account for ${flow.guestPhone}. Ask them to sign up on StayWithMe first.`;
  const res = await reserveForGuest({
    listingId: flow.listingId!,
    guestId: guest.id,
    checkIn: toUtcDate(flow.checkIn!),
    checkOut: toUtcDate(flow.checkOut!),
    guests: 1,
    amountPaid: rupees * 100,
  });
  return res.ok ? res.summary : res.error;
}

// ---------- inline block / unblock ----------
function parseBlockCmd(text: string) {
  const m = /^(block|unblock)\b/i.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase() as "block" | "unblock";
  const ds = text.match(/\d{1,2}[/-]\d{1,2}/g);
  if (!ds || ds.length < 2) return { cmd, unit: "", block: "", start: null as Date | null, end: null as Date | null };
  const afterCmd = text.trim().slice(m[0].length);
  const beforeDate = afterCmd.slice(0, afterCmd.indexOf(ds[0]));
  const tk = beforeDate.replace(/\b(from|to)\b/gi, " ").trim().split(/\s+/).filter(Boolean);
  return { cmd, unit: tk[0] ?? "", block: tk.slice(1).join(" "), start: parseDdmm(ds[0]), end: parseDdmm(ds[1]) };
}

async function handleBlock(text: string, phone: string): Promise<string> {
  const p = parseBlockCmd(text)!;
  if (!p.unit || !p.block || !p.start || !p.end)
    return `Send it like:\n${p.cmd} L1339 Paradise from 10/12 to 14/12`;
  if (p.end.getTime() <= p.start.getTime()) return "End date must be after the start date.";
  const r = await resolveFlat(p.unit, p.block);
  if ("error" in r) return r.error;
  return p.cmd === "block"
    ? doBlockDates(r.listing, p.start, p.end)
    : doUnblockDates(r.listing, p.start, p.end, phone);
}

// ---------- guided block / unblock (ask dates → ask flat) ----------
async function advanceBlockFlow(flow: Extract<Convo, { kind: "block" }>, text: string, phone: string): Promise<string> {
  if (flow.step === "dates") {
    const ds = text.match(/\d{1,2}[/-]\d{1,2}/g);
    const start = ds?.[0] ? parseDdmm(ds[0]) : null;
    const end = ds?.[1] ? parseDdmm(ds[1]) : null;
    if (!start || !end) return `Which dates to ${flow.cmd}? (e.g. 10/12 to 14/12)`;
    if (end.getTime() <= start.getTime()) return "End date must be after the start date.";
    flow.start = ymd(start);
    flow.end = ymd(end);
    flow.step = "flat";
    await setConvo(phone, flow);
    return "Which flat? (e.g. L1339, Paradise)";
  }
  // step "flat"
  const ref = parseFlatRef(text);
  if (!ref) return "Send the flat like: L1339, Paradise";
  const r = await resolveFlat(ref.unit, ref.block);
  if ("error" in r) return r.error; // keep the flow so they can retry the flat
  await delConvo(phone);
  const start = toUtcDate(flow.start!);
  const end = toUtcDate(flow.end!);
  return flow.cmd === "block"
    ? doBlockDates(r.listing, start, end)
    : doUnblockDates(r.listing, start, end, phone);
}

// ---------- guided cancel (ask dates → list flats → pick one) ----------
async function advanceCancel(flow: Extract<Convo, { kind: "cancel" }>, text: string, phone: string): Promise<string> {
  if (flow.step === "dates") {
    const ds = text.match(/\d{1,2}[/-]\d{1,2}/g);
    const start = ds?.[0] ? parseDdmm(ds[0]) : null;
    const end = ds?.[1] ? parseDdmm(ds[1]) : null;
    if (!start || !end) return "Which dates? (e.g. 10/12 to 14/12)";
    if (end.getTime() <= start.getTime()) return "Check-out must be after check-in.";
    const span = `${fmt(start)} → ${fmt(end)}`;
    const matches = await overlappingConfirmed(start, end);
    if (!matches.length) {
      await delConvo(phone);
      return `No confirmed reservation for ${span}.`;
    }
    if (matches.length === 1) {
      await delConvo(phone);
      const res = await cancelBooking(matches[0].id);
      return res.ok ? res.summary : res.error;
    }
    flow.start = ymd(start);
    flow.end = ymd(end);
    flow.candidates = matches.map((m) => ({
      bookingId: m.id,
      unit: m.listing.flatNumber ?? "—",
      block: m.listing.block ?? "—",
      guest: m.guest.name ?? m.guest.phone ?? "—",
    }));
    flow.step = "pick";
    await setConvo(phone, flow);
    return (
      "Which one to cancel? Reply with the flat:\n" +
      flow.candidates.map((c) => `• ${c.unit}, ${c.block} — ${c.guest}`).join("\n")
    );
  }
  // step "pick"
  const ref = parseFlatRef(text);
  if (!ref) return "Reply with the flat, e.g. L1339, Paradise";
  const cand = (flow.candidates ?? []).find(
    (c) => c.unit.toLowerCase() === ref.unit.toLowerCase() && c.block.toLowerCase() === ref.block.toLowerCase()
  );
  if (!cand) return "That flat isn't in the list. Reply with one shown, e.g. L1339, Paradise";
  await delConvo(phone);
  const res = await cancelBooking(cand.bookingId);
  return res.ok ? res.summary : res.error;
}

// Returns the reply text, or null to stay SILENT (don't send anything back).
async function handle(fromRaw: string, body: string): Promise<string | null> {
  const phone = normalizePhone(fromRaw);
  if (!phone) return null;

  const user = await prisma.user.findUnique({ where: { phone }, select: { isAdmin: true } });
  const adminPhone = process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : null;
  const isAdmin = !!user?.isAdmin || (!!adminPhone && phone === adminPhone);

  // Only the admin drives the bot. Every other number gets NO reply at all —
  // the bot stays completely silent rather than responding to strangers.
  if (!isAdmin) return null;

  const text = body.trim();
  const c = (text.split(/\s+/)[0] ?? "").toLowerCase();

  // Pending conversation?
  const flow = await getConvo(phone);
  if (flow) {
    if (c === "stop" || c === "reset") {
      await delConvo(phone);
      return "Cleared. Send: reserve · cancel · block · unblock · bookings · listings · earnings";
    }
    if (flow.kind === "unblockConfirm") {
      if (c === "yes") {
        await delConvo(phone);
        const res = await cancelBooking(flow.bookingId);
        await prisma.availabilityBlock.deleteMany({
          where: { listingId: flow.listingId, startDate: { lt: toUtcDate(flow.end) }, endDate: { gt: toUtcDate(flow.start) }, kind: "MANUAL" },
        });
        revalidateTag("listings");
        clearMemo();
        return res.ok ? `Freed the dates.\n\n${res.summary}` : res.error;
      }
      if (c === "no") {
        await delConvo(phone);
        return "Kept the booking — nothing changed.";
      }
      return "Reply YES to cancel the booking and free the dates, or NO to keep it.";
    }
    if (flow.kind === "reserveFwd") {
      return handleReserveFwd(flow, text, phone);
    }
    if (flow.kind === "cancel" && !KEYWORDS.includes(c)) {
      return advanceCancel(flow, text, phone);
    }
    if (flow.kind === "block" && !KEYWORDS.includes(c)) {
      return advanceBlockFlow(flow, text, phone);
    }
  }

  if (c === "stop" || c === "reset") {
    await delConvo(phone);
    return "Cleared. Send: reserve · cancel · block · unblock · bookings · listings · earnings";
  }

  if (c === "block" || c === "unblock") {
    // One-shot shortcut if the whole command is given; otherwise guide them.
    const p = parseBlockCmd(text);
    if (p && p.unit && p.block && p.start && p.end) return handleBlock(text, phone);
    await setConvo(phone, { kind: "block", cmd: c as "block" | "unblock", step: "dates" });
    return `Which dates to ${c}? (e.g. 10/12 to 14/12)`;
  }

  if (c === "reserve") {
    await setConvo(phone, { kind: "reserveFwd", step: "enquiry" });
    return "Forward me the guest's enquiry message and I'll set up the booking.";
  }

  if (c === "cancel") {
    await setConvo(phone, { kind: "cancel", step: "dates" });
    return "Which dates? (e.g. 10/12 to 14/12)";
  }

  if (c === "earnings") return earningsReport();

  if (c === "bookings" || c === "pending") {
    const list = await prisma.booking.findMany({
      where: { status: { in: ["PENDING", "CONFIRMED"] } },
      include: { listing: true, guest: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    if (!list.length) return "No active bookings.";
    return (
      "Bookings:\n" +
      list
        .map(
          (b) =>
            `#${b.id.slice(-6)} ${b.status === "CONFIRMED" ? "✅" : "⏳"} ${unitBlock(b.listing)} ${fmt(b.checkIn)}→${fmt(b.checkOut)} (${b.guest.name ?? "—"})`
        )
        .join("\n")
    );
  }

  if (c === "listings") {
    const all = await prisma.listing.findMany({
      where: { status: "PUBLISHED" },
      select: { flatNumber: true, block: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    if (!all.length) return "No published listings.";
    return "Listings:\n" + all.map((l) => `${unitBlock(l)} — ${l.title}`).join("\n");
  }

  return adminHelp();
}

// ---------- earnings (month-wise) ----------
async function earningsReport(): Promise<string> {
  const settings = await getPlatformSettings();
  const fee = settings.platformFeePercent;
  const confirmed = await prisma.booking.findMany({
    where: { status: "CONFIRMED" },
    include: { listing: { select: { basePrice: true } } },
  });
  if (!confirmed.length) return "No confirmed bookings yet.";

  // Group by check-in month.
  const months = new Map<string, { total: number; host: number; admin: number }>();
  for (const b of confirmed) {
    const nights = Math.max(1, Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / 86_400_000));
    const base = b.listing.basePrice * nights; // host payout
    const adminEarn = Math.round((base * fee) / 100); // platform fee
    const key = `${b.checkIn.getUTCFullYear()}-${String(b.checkIn.getUTCMonth() + 1).padStart(2, "0")}`;
    const m = months.get(key) ?? { total: 0, host: 0, admin: 0 };
    m.host += base;
    m.admin += adminEarn;
    m.total += base + adminEarn;
    months.set(key, m);
  }
  const sorted = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const label = (k: string) => {
    const [y, m] = k.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  return (
    "Earnings (by check-in month):\n\n" +
    sorted
      .map(
        ([k, m]) =>
          `${label(k)}\nTotal: ${formatINR(m.total)}\nHost payouts: ${formatINR(m.host)}\nYour earning: ${formatINR(m.admin)}`
      )
      .join("\n\n")
  );
}

function adminHelp() {
  return [
    "StayWithMe admin bot:",
    "",
    "reserve — forward the guest's enquiry to book",
    "cancel — cancel a booking (asks dates, then the flat)",
    "block — block a flat's dates (asks dates, then the flat)",
    "unblock — free blocked dates (asks dates, then the flat)",
    "bookings — active reservations",
    "listings — all flats",
    "earnings — month-wise totals",
    "",
    "Dates are DD/MM. Send stop to start over.",
  ].join("\n");
}
