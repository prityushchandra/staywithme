import React from "react";
import { Document, Page, View, Text, StyleSheet, type DocumentProps } from "@react-pdf/renderer";
import { formatINR } from "@/lib/pricing";
import { registerReceiptFonts, RECEIPT_FONT } from "@/lib/receipt-fonts";

registerReceiptFonts();

export interface StaffReceiptFlat {
  flat: string;
  days: number;
  dayList: number[];
}

export interface StaffReceiptData {
  staffName: string;
  staffPhone: string | null;
  month: string;
  monthLabelText: string;
  monthlySalary: number; // paise
  allowedLeaves: number;
  deductionPerDay: number; // paise
  absences: number; // total flat-days
  flatSummary: StaffReceiptFlat[];
  pay: number; // paise
  note: string | null;
}

const C = { brand: "#C8705E", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", soft: "#f9fafb", warn: "#b91c1c" };

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: RECEIPT_FONT, fontSize: 11, color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", backgroundColor: C.ink, borderRadius: 12, padding: 18, marginBottom: 14 },
  brand: { fontSize: 22, fontWeight: "bold", color: C.brand },
  hTitle: { fontSize: 13, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  hMonth: { fontSize: 12, fontWeight: "bold", color: "#ffffff", textAlign: "right" },
  hDate: { fontSize: 9, color: "#d1d5db", textAlign: "right", marginTop: 3 },
  label: { fontSize: 8, color: C.muted, letterSpacing: 1, marginBottom: 4 },
  staffCard: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginRight: 10 },
  totalCard: { width: 190, backgroundColor: C.brand, borderRadius: 10, padding: 12 },
  section: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginTop: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  th: { flexDirection: "row", backgroundColor: C.soft, paddingVertical: 7, paddingHorizontal: 10 },
  tr: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.line },
  divider: { borderBottomWidth: 1, borderBottomColor: C.line, marginVertical: 4 },
  muted: { color: C.muted },
  ref: { backgroundColor: "#fff7ed", borderRadius: 10, padding: 12, marginTop: 12 },
  refText: { color: "#7c2d12", fontSize: 10, lineHeight: 1.4 },
});

export function StaffReceiptPdf(d: StaffReceiptData): React.ReactElement<DocumentProps> {
  const extra = Math.max(0, d.absences - d.allowedLeaves);
  const docked = extra * d.deductionPerDay;
  return (
    <Document title={`Staff payout ${d.staffName} ${d.month}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>StayWithMe</Text>
            <Text style={s.hTitle}>Staff Payout</Text>
          </View>
          <View>
            <Text style={s.hMonth}>{d.monthLabelText}</Text>
            <Text style={s.hDate}>{new Date().toISOString().slice(0, 10)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", marginBottom: 2 }}>
          <View style={s.staffCard}>
            <Text style={s.label}>STAFF</Text>
            <Text style={{ fontSize: 15, fontWeight: "bold" }}>{d.staffName}</Text>
            <Text style={[s.muted, { marginTop: 3 }]}>{d.staffPhone || "No phone"}</Text>
          </View>
          <View style={s.totalCard}>
            <Text style={{ fontSize: 9, color: "#ffffff", opacity: 0.9 }}>NET PAYOUT</Text>
            <Text style={{ fontSize: 24, fontWeight: "bold", color: "#ffffff", marginTop: 3 }}>{formatINR(d.pay)}</Text>
            <Text style={{ fontSize: 9, color: "#ffffff", opacity: 0.9, marginTop: 3 }}>{d.monthLabelText}</Text>
          </View>
        </View>

        {/* Per-flat absence summary */}
        <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
          <View style={s.th}>
            <Text style={[s.muted, { flex: 1, fontSize: 9 }]}>FLAT MISSED</Text>
            <Text style={[s.muted, { width: 60, textAlign: "center", fontSize: 9 }]}>DAYS</Text>
            <Text style={[s.muted, { flex: 1.3, fontSize: 9 }]}>ON DAYS</Text>
          </View>
          {d.flatSummary.length === 0 ? (
            <View style={s.tr}><Text style={s.muted}>Full attendance — no flats missed.</Text></View>
          ) : (
            d.flatSummary.map((f, i) => (
              <View key={i} style={s.tr}>
                <Text style={{ flex: 1, fontWeight: "bold" }}>{f.flat}</Text>
                <Text style={{ width: 60, textAlign: "center" }}>{f.days}</Text>
                <Text style={[s.muted, { flex: 1.3 }]}>{f.dayList.join(", ")}</Text>
              </View>
            ))
          )}
        </View>

        <View style={s.section}>
          <Text style={s.label}>PAY BREAKDOWN</Text>
          <View style={s.row}>
            <Text style={s.muted}>Monthly salary</Text>
            <Text style={{ fontWeight: "bold" }}>{formatINR(d.monthlySalary)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.muted}>Total flat-days missed</Text>
            <Text style={{ color: extra > 0 ? C.warn : C.ink }}>{d.absences} / {d.allowedLeaves} allowed</Text>
          </View>
          <View style={s.row}>
            <Text style={s.muted}>Docked (beyond allowance)</Text>
            <Text style={{ color: docked > 0 ? C.warn : C.muted }}>{extra} × {formatINR(d.deductionPerDay)} = −{formatINR(docked)}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={{ fontWeight: "bold" }}>Net payout</Text>
            <Text style={{ fontWeight: "bold" }}>{formatINR(d.pay)}</Text>
          </View>
        </View>

        <View style={s.ref}>
          <Text style={s.refText}>
            Fixed monthly salary {formatINR(d.monthlySalary)} · {d.allowedLeaves} allowed flat-day leaves · then{" "}
            {formatINR(d.deductionPerDay)} per extra flat-day.
          </Text>
          {d.note ? <Text style={[s.refText, { marginTop: 4 }]}>Note: {d.note}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
