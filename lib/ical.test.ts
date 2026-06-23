import { describe, it, expect } from "vitest";
import { isSafeIcalUrl, parseIcalBusyRanges } from "./ical";

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
  it("rejects http, localhost, and IP literals", () => {
    expect(isSafeIcalUrl("http://www.airbnb.com/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://localhost/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://127.0.0.1/x.ics")).toBe(false);
    expect(isSafeIcalUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeIcalUrl("not a url")).toBe(false);
  });
});
