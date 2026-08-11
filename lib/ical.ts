// Minimal iCalendar (RFC 5545) reading for external calendar import (Airbnb,
// Vrbo, Booking.com all expose a per-listing .ics export URL). We need the busy
// date ranges, plus whether each one is a real reservation or a date the host
// merely blocked off — both make the date unavailable, but only a reservation
// earned money, so the P&L needs to tell them apart. No dependency needed.

import net from "node:net";

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this" network
    inRange("10.0.0.0", 8) || // RFC1918
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local (incl. cloud metadata 169.254.169.254)
    inRange("172.16.0.0", 12) || // RFC1918
    inRange("192.0.0.0", 24) ||
    inRange("192.168.0.0", 16) || // RFC1918
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved
  );
}

/**
 * True if an IP string is loopback / private / link-local / otherwise not a safe
 * public destination. Covers IPv4, IPv6, and IPv4-mapped IPv6.
 */
export function isPrivateIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIpv4(ip);
  if (fam === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIpv4(mapped[1]);
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }
  return true; // not a valid IP literal → unsafe to treat as one
}

/**
 * Cheap, synchronous URL guard before our server fetches a host-supplied link
 * (SSRF first line of defence): https only, no localhost-ish names, and any IP
 * *literal* must be public. Hostnames pass here but are DNS-validated against
 * private ranges at fetch time (see calendar-sync), since encoded forms like
 * "https://2130706433" or a domain pointing at 127.0.0.1 only resolve then.
 */
export function isSafeIcalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return false;
  }
  const fam = net.isIP(host);
  if (fam !== 0) return !isPrivateIp(host); // literal IP must be public
  return true; // hostname — resolved + re-checked at fetch time
}

export interface BusyRange {
  start: Date; // check-in, inclusive (UTC midnight)
  end: Date; // check-out, exclusive — matches iCal's exclusive DTEND for all-day events
  // A real booking, as opposed to dates the host blocked off on the other
  // platform. Both make the dates unavailable; only a reservation earned money.
  reserved: boolean;
}

// The note we stamp on imported blocks. Host-facing text that doubles as the
// only record of which imported dates were actually booked, so the P&L can use
// reservations alone as the denominator for the online daily rate.
export const ICAL_RESERVED_NOTE = "Airbnb reservation";
export const ICAL_BLOCKED_NOTE = "Blocked on Airbnb";

/**
 * The date from which a freshly-fetched feed is authoritative.
 *
 * Airbnb drops dates from its export once they're old enough, so replacing every
 * imported block on each sync would erase past stays we still need — they record
 * how many nights an already-banked payout covered. Imported blocks ending on or
 * before this cutoff are kept as history; everything after it is the feed's to
 * decide, so a cancelled or emptied calendar still frees those dates up.
 */
export function icalAuthoritativeFrom(ranges: BusyRange[], today: Date): Date {
  return ranges.reduce<Date>((min, r) => (r.start < min ? r.start : min), today);
}

// Parse a DTSTART/DTEND property line to a UTC-midnight date. Handles DATE
// ("YYYYMMDD"), DATE-TIME ("YYYYMMDDTHHMMSSZ"), and TZID-prefixed values — we
// floor to the calendar day, which is the granularity availability needs.
function parseDate(line: string): Date | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const value = line.slice(colon + 1).trim();
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Does a VEVENT summary describe a date the host blocked off rather than a
 * booking? Airbnb emits "Reserved" for bookings and "Airbnb (Not available)"
 * for manually-blocked dates. Anything we don't recognise counts as a booking,
 * so feeds that export bookings without a descriptive summary keep working.
 */
function isBlockedSummary(summary: string): boolean {
  return /not available|unavailable|blocked/i.test(summary);
}

/** Extract busy ranges from an iCal feed. */
export function parseIcalBusyRanges(text: string): BusyRange[] {
  // Unfold folded lines (a CRLF followed by a space/tab continues the prior line).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const ranges: BusyRange[] = [];
  let inEvent = false;
  let start: Date | null = null;
  let end: Date | null = null;
  let summary = "";

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      start = end = null;
      summary = "";
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (start && end && end.getTime() > start.getTime())
        ranges.push({ start, end, reserved: !isBlockedSummary(summary) });
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith("DTSTART")) start = parseDate(line);
    else if (line.startsWith("DTEND")) end = parseDate(line);
    else if (line.startsWith("SUMMARY")) {
      const colon = line.indexOf(":");
      if (colon !== -1) summary = line.slice(colon + 1).trim();
    }
  }
  return ranges;
}

// --- Export (StayWithMe → Airbnb/Vrbo/etc.) --------------------------------

export interface BusyEvent {
  uid: string;
  start: Date; // check-in (inclusive, UTC date)
  end: Date; // check-out (exclusive, UTC date)
  summary: string;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function icalEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Build a minimal RFC-5545 VCALENDAR of busy all-day ranges that other
 * platforms (Airbnb, Vrbo, Booking.com) can import to block these dates. DTEND
 * is exclusive (checkout morning), matching how we read their feeds.
 */
export function buildIcalFeed(events: BusyEvent[], calName: string): string {
  const stamp = `${ymd(new Date())}T000000Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayWithMe//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalEscape(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.start)}`,
      `DTEND;VALUE=DATE:${ymd(e.end)}`,
      `SUMMARY:${icalEscape(e.summary)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
