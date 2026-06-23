// Minimal iCalendar (RFC 5545) reading for external calendar import (Airbnb,
// Vrbo, Booking.com all expose a per-listing .ics export URL). We only need the
// busy date ranges, so we parse VEVENT DTSTART/DTEND and ignore everything else
// — no dependency needed.

/**
 * Guard the host-supplied URL before our server fetches it (SSRF protection):
 * https only, and never an IP literal / localhost (which could target internal
 * services or cloud metadata endpoints). Public hostnames are allowed so any
 * calendar provider works.
 */
export function isSafeIcalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host.includes(":") || host.startsWith("[")) return false; // IPv6 literal
  return true;
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
