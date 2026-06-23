import { describe, it, expect } from "vitest";
import { isSafeIcalUrl, isPrivateIp, parseIcalBusyRanges } from "./ical";

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
