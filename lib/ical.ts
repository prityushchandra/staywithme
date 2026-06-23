// Minimal iCalendar (RFC 5545) reading for external calendar import (Airbnb,
// Vrbo, Booking.com all expose a per-listing .ics export URL). We only need the
// busy date ranges, so we parse VEVENT DTSTART/DTEND and ignore everything else
// — no dependency needed.

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

/** Extract busy ranges from an iCal feed. */
export function parseIcalBusyRanges(text: string): BusyRange[] {
  // Unfold folded lines (a CRLF followed by a space/tab continues the prior line).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const ranges: BusyRange[] = [];
  let inEvent = false;
  let start: Date | null = null;
  let end: Date | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      start = end = null;
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (start && end && end.getTime() > start.getTime()) ranges.push({ start, end });
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith("DTSTART")) start = parseDate(line);
    else if (line.startsWith("DTEND")) end = parseDate(line);
  }
  return ranges;
}
