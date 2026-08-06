import { describe, it, expect } from "vitest";
import { isSafeIcalUrl, isPrivateIp, parseIcalBusyRanges, buildIcalFeed } from "./ical";

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
