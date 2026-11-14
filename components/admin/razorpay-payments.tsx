"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Building2, Clock3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { RazorpayBookingReference, RazorpayReport } from "@/lib/razorpay-report";

const PAGE_SIZE = 10;
const headingCell = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground";
const cell = "px-4 py-4 align-top text-sm";
const money = (value: number | null) => value === null ? "Not reported" : formatINR(value);
const date = (timestamp: number | null) => timestamp ? new Date(timestamp * 1000).toLocaleString("en-IN", {
  day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
}) : "Not reported";

function Status({ value }: { value: string }) {
  return <span className={cn(
    "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
    ["captured", "processed", "settled"].includes(value) ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : value === "failed" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
  )}>{value.replaceAll("_", " ")}</span>;
}

function Pagination({ count, page, onChange }: { count: number; page: number; onChange: (page: number) => void }) {
  if (count <= PAGE_SIZE) return null;
  return <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
    <p className="text-xs text-muted-foreground">{page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, count)} of {count}</p>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</Button>
      <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => onChange(page + 1)}>Next</Button>
    </div>
  </div>;
}

function RecoverPayment({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function recover() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile" }), signal: AbortSignal.timeout(45_000),
      });
      const result = await response.json();
      if (!response.ok || result.paid !== true) {
        throw new Error(result.error || "No captured payment found. No booking was changed.");
      }
      setFailed(false);
      setMessage("Payment recovered. Awaiting approval.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not check the payment. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-2 max-w-64 space-y-2">
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void recover()}>
      {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Check &amp; recover booking
    </Button>
    {message && <p role={failed ? "alert" : "status"} className={cn("text-xs", failed ? "text-destructive" : "text-emerald-700")}>{message}</p>}
  </div>;
}

export function RazorpayPayments({
  report, bookings, testMode,
}: {
  report: RazorpayReport;
  bookings: RazorpayBookingReference[];
  testMode: boolean;
}) {
  const [paymentPage, setPaymentPage] = useState(0);
  const [settlementPage, setSettlementPage] = useState(0);
  const [transactionPage, setTransactionPage] = useState(0);
  const byOrder = new Map(bookings.map((booking) => [booking.orderId, booking]));
  const settledPayments = new Map(report.transactions.filter((transaction) => transaction.type === "payment")
    .map((transaction) => [transaction.entity_id, transaction]));
  const settlementDates = new Map<string, number>();
  for (const transaction of report.transactions) {
    if (transaction.settled && transaction.settlement_id && transaction.settled_at) {
      settlementDates.set(transaction.settlement_id, Math.max(
        settlementDates.get(transaction.settlement_id) ?? 0, transaction.settled_at
      ));
    }
  }
  const summary = [
    { label: "Payments received", value: report.totals.gross, note: "Captured payments dated in this month" },
    { label: "Razorpay fees", value: report.totals.fees, note: `Includes GST: ${money(report.totals.tax)}` },
    { label: "Refunded", value: report.totals.refunds, note: "All refunds against these payments" },
    { label: "Net payments", value: report.totals.netPayments, note: "After fees and refunds; not bank balance" },
    { label: "Processed transfers", value: report.totals.processedSettlements, note: "Bank transfers created in this month" },
  ];

  return <div className="space-y-6">
    {testMode && <p role="status" className="rounded-xl border border-amber-300 bg-amber-500/5 p-4 text-sm">
      Test mode: these are simulated payments, not real bank transfers.
    </p>}
    {report.truncated && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-500/5 p-4 text-sm">
      This report reached the 2,000-entry limit in at least one section. Totals cover loaded entries only, not the complete month.
      Open Razorpay for the full ledger.
    </p>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {summary.map((item) => <div key={item.label} className="rounded-2xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
        <p className="mt-2 break-words text-xl font-semibold tracking-tight">{money(item.value)}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.note}</p>
      </div>)}
    </div>

    <div className="flex gap-3 rounded-2xl border bg-muted/30 p-5">
      <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
      <div className="space-y-1">
        <h2 className="font-semibold">Next bank credit: date not provided</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Razorpay does not provide your account&apos;s next bank-credit date through this API.
          Confirmed settlement dates are shown below when available, without guessing an arrival date.
          A processed settlement is Razorpay&apos;s transfer status, not confirmation from your bank.
        </p>
        <a href="https://dashboard.razorpay.com/" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">
          Open Razorpay <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>

    <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="razorpay-payments-title">
      <div className="border-b p-5">
        <h2 id="razorpay-payments-title" className="flex items-center gap-2 font-semibold">
          <ArrowDownLeft className="h-4 w-4 text-brand" /> Payments <span className="text-sm font-normal text-muted-foreground">({report.payments.length})</span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Payment dates are Razorpay transaction-creation times. Fees include GST. Failed and authorized attempts are not included in received totals.
        </p>
      </div>
      {report.payments.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No payments were created in this month.</p>
        : <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead className="bg-muted/30"><tr>
              {["Payment / booking", "Payment date (IST)", "Status", "Gross / refunded", "Fees / net", "Settlement match"].map((text) =>
                <th scope="col" className={headingCell} key={text}>{text}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {report.payments.slice(paymentPage * PAGE_SIZE, (paymentPage + 1) * PAGE_SIZE).map((payment) => {
                const booking = payment.order_id ? byOrder.get(payment.order_id) : undefined;
                const transaction = settledPayments.get(payment.id);
                const received = payment.status === "captured" || payment.status === "refunded";
                return <tr key={payment.id}>
                  <td className={cell}>
                    <p className="font-medium">{booking ? `${booking.guestName} - ${booking.listing}` : "Not linked to a StayWithMe booking"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{payment.id}</p>
                    {booking && <Link href="/admin/guest-bookings" className="mt-1 block text-xs underline underline-offset-2">
                      {booking.status.replaceAll("_", " ")}
                    </Link>}
                    {booking?.status === "PENDING" && payment.status === "captured" && <RecoverPayment bookingId={booking.id} />}
                  </td>
                  <td className={cn(cell, "whitespace-nowrap")}>{date(payment.created_at)}<p className="mt-1 text-xs text-muted-foreground">{payment.method?.toUpperCase() ?? "Method not reported"}</p></td>
                  <td className={cell}><Status value={payment.status} /></td>
                  <td className={cn(cell, "whitespace-nowrap")}>
                    <p className="font-medium">{money(payment.amount)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Refunded: {money(payment.amount_refunded)}</p>
                  </td>
                  <td className={cn(cell, "whitespace-nowrap")}>
                    <p>{money(payment.fee)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Net: {received
                      ? money(payment.fee === null ? null : payment.amount - payment.amount_refunded - payment.fee) : "Not received"}</p>
                  </td>
                  <td className={cell}>
                    {transaction ? <div className="space-y-1">
                      <Status value={transaction.on_hold ? "on hold" : transaction.settled ? "settled" : "not settled"} />
                      <p className="whitespace-nowrap text-xs">{transaction.settled ? date(transaction.settled_at) : "Date not reported"}</p>
                      <p className="font-mono text-xs text-muted-foreground">UTR: {transaction.settlement_utr || "Not reported"}</p>
                    </div> : <p className="max-w-40 text-xs text-muted-foreground">{received ? "Not matched in this month's report" : "Not applicable"}</p>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      <Pagination count={report.payments.length} page={paymentPage} onChange={setPaymentPage} />
    </section>

    <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="razorpay-settlements-title">
      <div className="border-b p-5">
        <h2 id="razorpay-settlements-title" className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-brand" /> Bank settlements</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Transfers created in the selected month. The amount is Razorpay&apos;s reported transfer amount; fees are not deducted again.
          Use the UTR to match the credit in your bank statement.
        </p>
      </div>
      {report.settlements.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No bank settlements were created in this month.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[850px]">
          <thead className="bg-muted/30"><tr>
            {["Settlement / UTR", "Transfer amount", "Status", "Created (IST)", "Settled (IST)", "Transfer fees / tax"].map((text) =>
              <th scope="col" className={headingCell} key={text}>{text}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {report.settlements.slice(settlementPage * PAGE_SIZE, (settlementPage + 1) * PAGE_SIZE).map((settlement) => <tr key={settlement.id}>
              <td className={cell}><p className="font-mono text-xs">{settlement.id}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">UTR: {settlement.utr || "Not reported"}</p></td>
              <td className={cn(cell, "whitespace-nowrap font-medium")}>{money(settlement.amount)}</td>
              <td className={cell}><Status value={settlement.status} /></td>
              <td className={cn(cell, "whitespace-nowrap")}>{date(settlement.created_at)}</td>
              <td className={cn(cell, "whitespace-nowrap")}>{date(settlementDates.get(settlement.id) ?? null)}</td>
              <td className={cn(cell, "whitespace-nowrap")}>{money(settlement.fees)}
                <p className="mt-1 text-xs text-muted-foreground">Tax reported: {money(settlement.tax)}</p></td>
            </tr>)}
          </tbody>
        </table></div>}
      <Pagination count={report.settlements.length} page={settlementPage} onChange={setSettlementPage} />
    </section>

    <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="razorpay-recon-title">
      <div className="border-b p-5">
        <h2 id="razorpay-recon-title" className="flex items-center gap-2 font-semibold"><ArrowUpRight className="h-4 w-4 text-brand" /> Settlement breakdown</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Transactions reported in this month&apos;s settlement reconciliation, including payments from earlier months.
          A missing match does not prove a payment is still pending; it may settle in another month.
        </p>
      </div>
      {report.transactions.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Razorpay has not reported any settlement transactions for this month.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
          <thead className="bg-muted/30"><tr>
            {["Transaction / type", "Transaction date (IST)", "Settled (IST)", "Credit", "Debit", "Settlement / UTR"].map((text) =>
              <th scope="col" className={headingCell} key={text}>{text}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {report.transactions.slice(transactionPage * PAGE_SIZE, (transactionPage + 1) * PAGE_SIZE).map((transaction, index) =>
              <tr key={`${transaction.entity_id}-${transaction.settlement_id}-${index}`}>
                <td className={cell}><p className="font-mono text-xs">{transaction.entity_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{transaction.type}</p></td>
                <td className={cn(cell, "whitespace-nowrap")}>{date(transaction.created_at)}</td>
                <td className={cn(cell, "whitespace-nowrap")}>{transaction.on_hold ? "On hold" : transaction.settled ? date(transaction.settled_at) : "Not settled"}</td>
                <td className={cn(cell, "whitespace-nowrap text-emerald-700 dark:text-emerald-400")}>{money(transaction.credit)}</td>
                <td className={cn(cell, "whitespace-nowrap")}>{money(transaction.debit)}</td>
                <td className={cell}><p className="font-mono text-xs">{transaction.settlement_id || "Not reported"}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">UTR: {transaction.settlement_utr || "Not reported"}</p></td>
              </tr>)}
          </tbody>
        </table></div>}
      <Pagination count={report.transactions.length} page={transactionPage} onChange={setTransactionPage} />
    </section>
    <p className="text-xs leading-relaxed text-muted-foreground">
      Live account-wide data, including payments outside StayWithMe. Payment and settlement totals cover different timelines;
      their difference is not your pending balance. Last fetched {date(report.loadedAt)} IST.
    </p>
  </div>;
}

export function RefreshPayments() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <Button variant="outline" size="sm" disabled={refreshing} onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} /> {refreshing ? "Refreshing" : "Refresh"}
  </Button>;
}
