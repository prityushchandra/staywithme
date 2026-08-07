// Google Sheets backup sync. Appends rows to tabs of a spreadsheet using a
// Google service account — no SDK dependency: we sign the OAuth2 JWT with Node's
// crypto and call the Sheets REST API directly. Every export is BEST-EFFORT and
// never throws into the caller, and the whole module no-ops safely when the
// service account env vars aren't set, so the app works with or without Sheets.
//
// Setup (all in env / Vercel):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL = xxx@yyy.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY           = the service account private key (with \n)
//   GOOGLE_SHEETS_ID             = the spreadsheet id from its URL
// Share the sheet with the service-account email (Editor).

import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export type SheetTab = "Bookings" | "Revenue" | "Receipts" | "StaffPayroll";

function cfg() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!email || !key || !sheetId) return null;
  return { email, key, sheetId };
}

export function isSheetsConfigured(): boolean {
  return cfg() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(email: string, key: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signature = base64url(
    crypto.createSign("RSA-SHA256").update(unsigned).sign(key)
  );
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    console.error("[sheets] token exchange failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

/** Append one row of cells to a tab. Best-effort; returns false on any failure. */
export async function appendRow(
  tab: SheetTab,
  row: (string | number)[]
): Promise<boolean> {
  const c = cfg();
  if (!c) return false;
  try {
    const token = await getAccessToken(c.email, c.key);
    if (!token) return false;
    const range = encodeURIComponent(`${tab}!A1`);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}` +
      `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    });
    if (!res.ok) {
      console.error("[sheets] append failed", tab, res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sheets] append error", tab, (e as Error).message);
    return false;
  }
}

// --- High-level, app-specific mirrors (₹ display values, paise kept too) ------

const rupees = (paise: number) => (paise / 100).toFixed(2);
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export interface OfflineBookingRow {
  receiptNumber?: string;
  listingTitle: string;
  flat?: string | null;
  guestName: string;
  guestPhone?: string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  guests: number;
  totalPrice: number; // paise
  amountPaid: number; // paise
  due: number; // paise
  source: string;
  status: string;
  createdAt?: Date | string;
}

/** Mirror an offline/Airbnb booking to the Bookings + Revenue tabs. */
export async function syncOfflineBooking(b: OfflineBookingRow): Promise<void> {
  await appendRow("Bookings", [
    b.receiptNumber ?? "",
    b.createdAt ? iso(b.createdAt) : iso(new Date()),
    b.listingTitle,
    b.flat ?? "",
    b.guestName,
    b.guestPhone ?? "",
    iso(b.checkIn),
    iso(b.checkOut),
    b.guests,
    rupees(b.totalPrice),
    rupees(b.amountPaid),
    rupees(b.due),
    b.source,
    b.status,
  ]);
}

export interface StaffPayrollRow {
  month: string;
  staffName: string;
  absences: number;
  allowedLeaves: number;
  monthlySalary: number; // paise
  deductionPerDay: number; // paise
  pay: number; // paise
  note?: string | null;
}

/** Mirror a monthly staff payout entry to the StaffPayroll tab. */
export async function syncStaffPayroll(a: StaffPayrollRow): Promise<void> {
  await appendRow("StaffPayroll", [
    a.month,
    a.staffName,
    a.absences,
    a.allowedLeaves,
    rupees(a.monthlySalary),
    rupees(a.deductionPerDay),
    rupees(a.pay),
    a.note ?? "",
  ]);
}

export interface ReceiptRow {
  number: string;
  type: string; // BOOKING | STAFF
  who: string; // guest or staff name
  amount: number; // paise
  createdAt?: Date | string;
}

/** Mirror any generated receipt to the Receipts tab. */
export async function syncReceipt(r: ReceiptRow): Promise<void> {
  await appendRow("Receipts", [
    r.number,
    r.createdAt ? iso(r.createdAt) : iso(new Date()),
    r.type,
    r.who,
    rupees(r.amount),
  ]);
}
