import { describe, it, expect } from "vitest";
import { isSafeIcalUrl, isPrivateIp, parseIcalBusyRanges, icalAuthoritativeFrom, buildIcalFeed } from "./ical";

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260625",
  "DTEND;VALUE=DATE:20260628",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260701",
  "DTEND;VALUE=DATE:20260703",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcalBusyRanges", () => {
  it("extracts each VEVENT's start/end as UTC-midnight, end exclusive", () => {
    const r = parseIcalBusyRanges(ics);
    expect(r).toHaveLength(2);
    expect(r[0].start.toISOString()).toBe("2026-06-25T00:00:00.000Z");
    expect(r[0].end.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(r[1].start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("ignores malformed or zero-length events", () => {
    const bad = "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260625\r\nEND:VEVENT";
    expect(parseIcalBusyRanges(bad)).toHaveLength(0); // no DTEND
  });

  it("handles DATE-TIME values by flooring to the day", () => {
    const dt =
      "BEGIN:VEVENT\r\nDTSTART:20260625T140000Z\r\nDTEND:20260626T110000Z\r\nEND:VEVENT";
    const r = parseIcalBusyRanges(dt);
    expect(r[0].start.toISOString()).toBe("2026-06-25T00:00:00.000Z");
    expect(r[0].end.toISOString()).toBe("2026-06-26T00:00:00.000Z");
  });

  // Both kinds block the calendar, but only a reservation earned money — the
  // P&L divides online revenue by reserved nights alone.
  it("marks dates the host blocked on the other platform as not reserved", () => {
    const r = parseIcalBusyRanges(ics);
    expect(r[0].reserved).toBe(false); // "Airbnb (Not available)"
    expect(r[1].reserved).toBe(true); // no SUMMARY at all
  });

  it("marks Airbnb's 'Reserved' events as reservations", () => {
    const feed = [
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260809",
      "DTEND;VALUE=DATE:20260810",
      "SUMMARY:Reserved",
      "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/x",
      "END:VEVENT",
    ].join("\r\n");
    expect(parseIcalBusyRanges(feed)[0].reserved).toBe(true);
  });

  it("recognises other wordings for blocked dates", () => {
    for (const s of ["Airbnb (Not available)", "Blocked", "Unavailable", "NOT AVAILABLE"]) {
      const feed = `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260809\r\nDTEND;VALUE=DATE:20260810\r\nSUMMARY:${s}\r\nEND:VEVENT`;
      expect(parseIcalBusyRanges(feed)[0].reserved).toBe(false);
    }
  });

  it("does not leak a summary from one event into the next", () => {
    const feed = [
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260809",
      "DTEND;VALUE=DATE:20260810",
      "SUMMARY:Airbnb (Not available)",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260812",
      "DTEND;VALUE=DATE:20260814",
      "SUMMARY:Reserved",
      "END:VEVENT",
    ].join("\r\n");
    const r = parseIcalBusyRanges(feed);
    expect(r.map((x) => x.reserved)).toEqual([false, true]);
  });
});

describe("isSafeIcalUrl", () => {
  it("allows https public hosts", () => {
    expect(isSafeIcalUrl("https://www.airbnb.com/calendar/ical/123.ics?s=abc")).toBe(true);
  });
  it("rejects http, localhost, and private/link-local IP literals", () => {
    expect(isSafeIcalUrl("http://www.airbnb.com/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://localhost/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://127.0.0.1/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://10.1.2.3/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://192.168.0.5/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeIcalUrl("https://[::1]/x.ics")).toBe(false);
    expect(isSafeIcalUrl("not a url")).toBe(false);
  });
  it("allows a public IP literal", () => {
    expect(isSafeIcalUrl("https://8.8.8.8/x.ics")).toBe(true);
  });
});

describe("isPrivateIp", () => {
  it("flags loopback, RFC1918, link-local, and metadata IPs", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "::ffff:127.0.0.1",
      "fe80::1",
      "fc00::1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("buildIcalFeed", () => {
  const feed = buildIcalFeed(
    [
      {
        uid: "swm-abc@staywithme.co.in",
        start: new Date(Date.UTC(2026, 6, 31)), // 31 Jul
        end: new Date(Date.UTC(2026, 7, 2)), // 2 Aug (exclusive)
        summary: "Reserved (StayWithMe)",
      },
    ],
    "StayWithMe — Test, Flat"
  );

  it("round-trips through the parser to the same busy range", () => {
    const r = parseIcalBusyRanges(feed);
    expect(r).toHaveLength(1);
    expect(r[0].start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(r[0].end.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("emits all-day DATE values and required calendar scaffolding", () => {
    expect(feed).toContain("BEGIN:VCALENDAR");
    expect(feed).toContain("END:VCALENDAR");
    expect(feed).toContain("DTSTART;VALUE=DATE:20260731");
    expect(feed).toContain("DTEND;VALUE=DATE:20260802");
    expect(feed).toContain("UID:swm-abc@staywithme.co.in");
    expect(feed.endsWith("\r\n")).toBe(true);
  });

  it("escapes commas in the calendar name", () => {
    expect(feed).toContain("X-WR-CALNAME:StayWithMe — Test\\, Flat");
  });

  it("produces an empty but valid calendar when there are no events", () => {
    const empty = buildIcalFeed([], "Empty");
    expect(empty).toContain("BEGIN:VCALENDAR");
    expect(empty).toContain("END:VCALENDAR");
    expect(empty).not.toContain("BEGIN:VEVENT");
    expect(parseIcalBusyRanges(empty)).toHaveLength(0);
  });
});

describe("icalAuthoritativeFrom", () => {
  const today = new Date("2026-08-12T00:00:00.000Z");
  const range = (s: string, e: string) => ({
    start: new Date(`${s}T00:00:00.000Z`),
    end: new Date(`${e}T00:00:00.000Z`),
    reserved: true,
  });

  it("starts at the feed's earliest event when that predates today", () => {
    // Airbnb still reports Aug 5, so it is authoritative from there — anything
    // older has aged out of the export and must be kept as history.
    const cut = icalAuthoritativeFrom([range("2026-08-17", "2026-08-24"), range("2026-08-05", "2026-08-10")], today);
    expect(cut.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("never reaches past today when every event is in the future", () => {
    // Today onwards is always the feed's to decide, so dates it dropped still free up.
    const cut = icalAuthoritativeFrom([range("2026-09-01", "2026-09-05")], today);
    expect(cut.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("falls back to today for an emptied calendar", () => {
    expect(icalAuthoritativeFrom([], today).toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("keeps history that ends before the cutoff and yields to the feed after it", () => {
    const cut = icalAuthoritativeFrom([range("2026-08-05", "2026-08-10")], today);
    const endsBefore = (e: string) => new Date(`${e}T00:00:00.000Z`) <= cut;
    expect(endsBefore("2026-07-28")).toBe(true); // aged-out July stay — kept
    expect(endsBefore("2026-08-05")).toBe(true); // ends exactly at the cutoff — kept, no overlap
    expect(endsBefore("2026-08-06")).toBe(false); // overlaps the feed — replaced
  });
});