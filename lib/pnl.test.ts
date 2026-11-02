import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as exportPnl } from "@/app/api/admin/pnl/export/route";
import { ICAL_RESERVED_NOTE } from "@/lib/ical";
import { clearMemo } from "@/lib/memo";
import { monthlyBreakdown, perFlatBreakdown, summarize } from "@/lib/pnl-compute";
import * as xlsx from "@/lib/xlsx";
import { getPnlData } from "./pnl";

const mocks = vi.hoisted(() => ({
  listing: { findMany: vi.fn() },
  booking: { findMany: vi.fn() },
  offlineBooking: { findMany: vi.fn() },
  onlineEarning: { findMany: vi.fn() },
  staffMonth: { findMany: vi.fn() },
  availabilityBlock: { findMany: vi.fn() },
  listingDotMonth: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
  auth: vi.fn(),
  syncStaleCalendars: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/calendar-sync", () => ({ syncStaleCalendars: mocks.syncStaleCalendars }));

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

function makeFixture() {
  const listings = ["visible", "hidden"].map((id) => ({
    id,
    title: id === "visible" ? "Visible flat" : "Hidden flat",
    flatNumber: null,
    block: null,
    createdAt: utc("2026-09-01"),
    status: "PUBLISHED",
    isVisible: true,
    visibilityMonths: [{ month: "2026-11", isVisible: true }],
  }));
  const scaled = [{ listingId: "visible", scale: 1 }, { listingId: "hidden", scale: 10 }];
  return {
    listings,
    bookings: scaled.map(({ listingId, scale }) => ({
      listingId, checkIn: utc("2026-10-31"), checkOut: utc("2026-11-02"), totalAmount: 20_000 * scale,
    })),
    offlineBookings: scaled.flatMap(({ listingId, scale }) => [
      { listingId, checkIn: utc("2026-11-03"), checkOut: utc("2026-11-05"), totalPrice: 20_000 * scale, source: "OFFLINE" },
      { listingId, checkIn: utc("2026-11-10"), checkOut: utc("2026-11-12"), totalPrice: 30_000 * scale, source: "AIRBNB" },
    ]),
    earnings: scaled.flatMap(({ listingId, scale }) => [
      { listingId, month: "2026-10", amount: 5_000 * scale },
      { listingId, month: "2026-11", amount: 40_000 * scale },
      { listingId, month: "2026-12", amount: 50_000 * scale },
      { listingId, month: "2027-01", amount: 60_000 * scale },
    ]),
    staffMonths: [
      { month: "2026-10", pay: 100_001 },
      { month: "2026-11", pay: 90_001 },
      { month: "2026-11", pay: 10_000 },
      { month: "2026-12", pay: 100_001 },
      { month: "2027-01", pay: 100_001 },
    ],
    blocks: listings.flatMap(({ id: listingId }) => [
      { listingId, startDate: utc("2026-10-10"), endDate: utc("2026-10-12"), kind: "ICAL", note: ICAL_RESERVED_NOTE },
      { listingId, startDate: utc("2026-10-31"), endDate: utc("2026-11-02"), kind: "BOOKING", note: null },
      { listingId, startDate: utc("2026-11-03"), endDate: utc("2026-11-05"), kind: "BOOKING", note: null },
      { listingId, startDate: utc("2026-11-10"), endDate: utc("2026-11-14"), kind: "ICAL", note: ICAL_RESERVED_NOTE },
      { listingId, startDate: utc("2026-11-20"), endDate: utc("2026-11-22"), kind: "MANUAL", note: null },
    ]),
    dots: listings.flatMap(({ id: listingId }) => [
      { listingId, month: "2026-10", days: [7, 8] },
      { listingId, month: "2026-11", days: [2, 15] },
    ]),
    expenses: scaled.flatMap(({ listingId, scale }) => [
      { listingId, month: "2026-10", type: "RENT", nature: "RUNNING", amount: 1_000 * scale },
      { listingId, month: "2026-11", type: "RENT", nature: "RUNNING", amount: 10_000 * scale },
      { listingId, month: "2026-11", type: "ELECTRICITY", nature: "RUNNING", amount: 2_000 * scale },
      { listingId, month: "2026-11", type: "OTHER", nature: "SETUP", amount: 50_000 * scale },
      { listingId, month: "2026-12", type: "RENT", nature: "RUNNING", amount: 11_000 * scale },
      { listingId, month: "2027-01", type: "RENT", nature: "RUNNING", amount: 12_000 * scale },
    ]),
  };
}

let fixture: ReturnType<typeof makeFixture>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  clearMemo();
  fixture = makeFixture();
  mocks.listing.findMany.mockImplementation(async () => fixture.listings);
  mocks.booking.findMany.mockImplementation(async () => fixture.bookings);
  mocks.offlineBooking.findMany.mockImplementation(async () => fixture.offlineBookings);
  mocks.onlineEarning.findMany.mockImplementation(async () => fixture.earnings);
  mocks.staffMonth.findMany.mockImplementation(async () => fixture.staffMonths);
  mocks.availabilityBlock.findMany.mockImplementation(async () => fixture.blocks);
  mocks.listingDotMonth.findMany.mockImplementation(async () => fixture.dots);
  mocks.expense.findMany.mockImplementation(async () => fixture.expenses);
  mocks.auth.mockResolvedValue({ user: { isAdmin: true } });
  mocks.syncStaleCalendars.mockResolvedValue(undefined);
});
afterEach(() => {
  clearMemo();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function hide(index = 1) {
  fixture.listings[index].isVisible = false;
  fixture.listings[index].visibilityMonths[0].isVisible = false;
}

describe("month-aware listed-only P&L", () => {
  it("immediately excludes all current/future metrics, reallocates all net pay, and preserves past rows", async () => {
    const original = await getPnlData();
    hide();
    const unchangedInputs = structuredClone(fixture);
    // No clearMemo: a toggle may have happened on a different server instance.
    const result = await getPnlData();
    expect(mocks.listing.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.listing.findMany).toHaveBeenLastCalledWith({
      select: expect.objectContaining({
        status: true, isVisible: true,
        visibilityMonths: { select: { month: true, isVisible: true } },
      }),
    });
    expect(result.rows.filter((r) => r.month < "2026-11")).toEqual(original.rows.filter((r) => r.month < "2026-11"));
    expect(result.rows.some((r) => r.month >= "2026-11" && r.listingId === "hidden")).toBe(false);
    const current = result.rows.filter((r) => r.month === "2026-11");
    expect(current).toHaveLength(1);
    expect(summarize(current)).toMatchObject({
      revenueDirect: 10_000, revenueOffline: 20_000, revenueOnline: 70_000, revenueTotal: 100_000,
      nightsDirect: 1, nightsOffline: 2, nightsOnline: 4, nightsTotal: 7,
      rent: 10_000, expenseOther: 2_000, staff: 100_001, expenseTotal: 112_001,
      setup: 50_000, profit: -12_001, unbookedDays: 15, dots: 2,
    });
    expect(perFlatBreakdown(current).map((r) => r.listingId)).toEqual(["visible"]);
    expect(monthlyBreakdown(result.rows, ["2026-11"])[0]).toMatchObject({
      revenueTotal: 100_000, expenseTotal: 112_001, unbookedDays: 15, dots: 2,
    });
    expect(fixture).toEqual(unchangedInputs);
  });

  it("carries exclusion into later months and relists without changing the intervening or pre-tracking months", async () => {
    hide();
    const november = await getPnlData();
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    const december = await getPnlData();
    expect(december.rows.some((r) => r.listingId === "hidden" && r.month >= "2026-11")).toBe(false);
    vi.setSystemTime(new Date("2027-01-15T12:00:00Z"));
    fixture.listings[1].isVisible = true;
    // Deliberately unsorted: choosing the latest applicable month must not rely
    // on the database's incidental row order.
    fixture.listings[1].visibilityMonths.unshift({ month: "2027-01", isVisible: true });
    const january = await getPnlData();
    expect(january.rows.filter((r) => r.month === "2026-10")).toEqual(november.rows.filter((r) => r.month === "2026-10"));
    expect(january.rows.filter((r) => r.month === "2026-11")).toEqual(december.rows.filter((r) => r.month === "2026-11"));
    expect(january.rows.some((r) => r.listingId === "hidden" && ["2026-11", "2026-12"].includes(r.month))).toBe(false);
    expect(summarize(january.rows.filter((r) => r.month === "2026-12")).staff).toBe(100_001);
    const relisted = january.rows.filter((r) => r.month === "2027-01");
    expect(relisted.map((r) => r.listingId).sort()).toEqual(["hidden", "visible"]);
    expect(relisted.map((r) => r.staff).sort()).toEqual([50_000, 50_001]);
    expect(summarize(relisted).revenueTotal).toBe(660_000);
  });

  it.each(["PUBLISHED", "DRAFT", "PENDING", "APPROVED", "REJECTED"])(
    "excludes an existing unlisted %s flat now without guessing its past visibility",
    async (status) => {
      fixture.listings[1].status = status;
      fixture.listings[1].isVisible = status !== "PUBLISHED";
      fixture.listings[1].visibilityMonths = [];
      const result = await getPnlData();
      expect(result.rows.some((r) => r.listingId === "hidden" && r.month === "2026-10")).toBe(true);
      expect(result.rows.some((r) => r.listingId === "hidden" && r.month >= "2026-11")).toBe(false);
      expect(summarize(result.rows.filter((r) => r.month === "2026-11")).staff).toBe(100_001);
    }
  );

  it("keeps the onboarding salary fallback within the month's scope and makes no ghost rows when all are hidden", async () => {
    fixture.listings.forEach((l) => { l.createdAt = utc("2026-12-01"); });
    hide();
    const oneIncluded = await getPnlData();
    expect(oneIncluded.rows.filter((r) => r.month === "2026-11")).toMatchObject([
      { listingId: "visible", staff: 100_001 },
    ]);
    hide(0);
    const allHidden = await getPnlData();
    expect(allHidden.rows.filter((r) => r.month >= "2026-11")).toEqual([]);
    expect(summarize(allHidden.rows.filter((r) => r.month === "2026-11"))).toMatchObject({
      revenueTotal: 0, expenseTotal: 0, staff: 0, setup: 0, nightsTotal: 0, unbookedDays: 0, dots: 0,
    });
    expect(allHidden.rows.filter((r) => r.month === "2026-10")).toEqual(oneIncluded.rows.filter((r) => r.month === "2026-10"));
  });

  it("rolls the reporting month over at India midnight without excluding the month that just ended", async () => {
    vi.setSystemTime(new Date("2026-10-31T18:29:59.999Z"));
    expect((await getPnlData()).currentMonth).toBe("2026-10");
    vi.setSystemTime(new Date("2026-10-31T18:30:00Z"));
    hide();
    const result = await getPnlData();
    expect(result.currentMonth).toBe("2026-11");
    expect(result.rows.some((r) => r.listingId === "hidden" && r.month === "2026-10")).toBe(true);
    expect(result.rows.some((r) => r.listingId === "hidden" && r.month === "2026-11")).toBe(false);
  });

  it("does not let a hidden future booking evict visible historical data from the bounded report", async () => {
    hide();
    fixture.bookings.push({
      listingId: "hidden", checkIn: utc("2035-05-01"), checkOut: utc("2035-05-03"), totalAmount: 123_456,
    });
    const result = await getPnlData();
    expect(result.months.at(-1)).toBe("2027-03");
    expect(result.rows.some((r) => r.month === "2026-10")).toBe(true);
  });
});

describe("P&L Excel scope with mocked database and calendar sync", () => {
  it("exports the same visible-only totals as the dashboard and keeps historical flats in earlier exports", async () => {
    hide();
    const build = vi.spyOn(xlsx, "buildXlsx");
    const result = await exportPnl(new Request("http://localhost/api/admin/pnl/export?fy=2026&month=2026-11"));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(mocks.syncStaleCalendars).toHaveBeenCalledWith(60_000);
    const sheets = build.mock.calls[0][0];
    const summary = sheets.find((s) => s.name === "Summary")!.rows;
    expect(summary).toEqual(expect.arrayContaining([
      ["Total revenue", 1_000],
      ["Days booked", "7"],
      ["Staff salaries", 1_000.01],
      ["Total expenses", 1_120.01],
      ["Net profit", -120.01],
      ["Setup spend (not in P&L)", 500],
      ["Unbooked (available) days", "15"],
      ["Dots (days gone unsold)", "2"],
    ]));
    expect(sheets.find((s) => s.name === "By flat")!.rows.map((r) => r[0])).toEqual(["Flat", "Visible flat", "All flats"]);
    expect(sheets.find((s) => s.name === "Monthly")!.rows[1]).toEqual([
      "Nov 2026", 1_000, 100, 20, 1_000.01, 1_120.01, -120.01, "-12.0%", 15, 2,
    ]);
    await exportPnl(new Request("http://localhost/api/admin/pnl/export?fy=2026&month=2026-10"));
    const historical = build.mock.calls[1][0];
    expect(historical.find((s) => s.name === "By flat")!.rows.map((r) => r[0])).toEqual(
      expect.arrayContaining(["Visible flat", "Hidden flat"])
    );
    expect(historical.find((s) => s.name === "Summary")!.rows).toContainEqual(["Total revenue", 1_650]);

    hide(0);
    await exportPnl(new Request("http://localhost/api/admin/pnl/export?fy=2026&month=2026-11"));
    const empty = build.mock.calls[2][0];
    expect(empty.find((s) => s.name === "By flat")!.rows.map((r) => r[0])).toEqual(["Flat", "All flats"]);
    expect(empty.find((s) => s.name === "Summary")!.rows).toContainEqual(["Staff salaries", 0]);
  });
});
