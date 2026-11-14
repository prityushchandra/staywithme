import {
  listRazorpayPayments,
  listRazorpaySettlements,
  listRazorpaySettlementTransactions,
} from "./razorpay";

const IST_OFFSET_MS = 330 * 60_000;
export const MIN_REPORT_MONTH = "2000-02";

export function currentRazorpayMonth(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
}

export function razorpayMonthRange(month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      month < MIN_REPORT_MONTH || month > currentRazorpayMonth(now)) {
    throw new Error("Choose a valid month up to the current month.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    year, month: monthNumber,
    from: (Date.UTC(year, monthNumber - 1, 1) - IST_OFFSET_MS) / 1000,
    to: Math.min(
      (Date.UTC(year, monthNumber, 1) - IST_OFFSET_MS) / 1000 - 1,
      Math.floor(now.getTime() / 1000)
    ),
  };
}

export async function getRazorpayReport(month: string) {
  const now = new Date();
  const range = razorpayMonthRange(month, now);
  const [payments, settlements, transactions] = await Promise.all([
    listRazorpayPayments(range.from, range.to),
    listRazorpaySettlements(range.from, range.to),
    listRazorpaySettlementTransactions(range.year, range.month),
  ]);
  if (payments.items.some((payment) => payment.currency !== "INR") ||
      transactions.items.some((transaction) => transaction.currency !== "INR") ||
      settlements.items.some((settlement) => settlement.currency && settlement.currency !== "INR")) {
    throw new Error("This report supports the INR merchant account only. Review other currencies in Razorpay.");
  }

  const received = payments.items.filter((payment) => payment.status === "captured" || payment.status === "refunded");
  const gross = received.reduce((total, payment) => total + payment.amount, 0);
  const refunds = received.reduce((total, payment) => total + payment.amount_refunded, 0);
  const fees = received.reduce<number | null>((total, payment) =>
    total === null || payment.fee === null ? null : total + payment.fee, 0);
  const tax = received.reduce<number | null>((total, payment) =>
    total === null || payment.tax === null ? null : total + payment.tax, 0);

  return {
    month,
    loadedAt: Math.floor(now.getTime() / 1000),
    truncated: payments.truncated || settlements.truncated || transactions.truncated,
    payments: payments.items.sort((a, b) => b.created_at - a.created_at),
    settlements: settlements.items.sort((a, b) => b.created_at - a.created_at),
    transactions: transactions.items.sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0)),
    totals: {
      gross, refunds, fees, tax,
      // Payment.fee already includes GST; subtracting tax again understates net.
      netPayments: fees === null ? null : gross - refunds - fees,
      processedSettlements: settlements.items.filter((settlement) => settlement.status === "processed")
        .reduce((total, settlement) => total + settlement.amount, 0),
    },
  };
}

export type RazorpayReport = Awaited<ReturnType<typeof getRazorpayReport>>;

export type RazorpayBookingReference = {
  id: string;
  orderId: string;
  guestName: string;
  listing: string;
  status: string;
};
