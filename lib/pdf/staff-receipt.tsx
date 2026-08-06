import React from "react";
import { Document, Page, View, Text, StyleSheet, type DocumentProps } from "@react-pdf/renderer";
import { formatINR } from "@/lib/pricing";
import { registerReceiptFonts, RECEIPT_FONT } from "@/lib/receipt-fonts";

registerReceiptFonts();

export interface StaffReceiptRow {
  flat: string;
  absences: number;
  allowedHolidays: number;
  absentDays: number[];
  pay: number;
}

export interface StaffReceiptData {
  staffName: string;
  staffPhone: string | null;
  month: string;
  monthLabelText: string;
  rows: StaffReceiptRow[];
  total: number;
  monthlySalary: number;
  allowedHolidays: number;
  deductionPerDay: number;
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
  th: { flexDirection: "row", backgroundColor: C.soft, paddingVertical: 8, paddingHorizontal: 10 },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.line },
  muted: { color: C.muted },
  ref: { backgroundColor: "#fff7ed", borderRadius: 10, padding: 12, marginTop: 12 },
  refText: { color: "#7c2d12", fontSize: 10, lineHeight: 1.4 },
});

export function StaffReceiptPdf(d: StaffReceiptData): React.ReactElement<DocumentProps> {
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

        <View style={{ flexDirection: "row", marginBottom: 12 }}>
          <View style={s.staffCard}>
            <Text style={s.label}>STAFF</Text>
            <Text style={{ fontSize: 15, fontWeight: "bold" }}>{d.staffName}</Text>
            <Text style={[s.muted, { marginTop: 3 }]}>{d.staffPhone || "No phone"}</Text>
          </View>
          <View style={s.totalCard}>
            <Text style={{ fontSize: 9, color: "#ffffff", opacity: 0.9 }}>NET PAYOUT</Text>
            <Text style={{ fontSize: 24, fontWeight: "bold", color: "#ffffff", marginTop: 3 }}>{formatINR(d.total)}</Text>
            <Text style={{ fontSize: 9, color: "#ffffff", opacity: 0.9, marginTop: 3 }}>{d.rows.length} flat{d.rows.length === 1 ? "" : "s"}</Text>
          </View>
        </View>

        <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" }}>
          <View style={s.th}>
            <Text style={[s.muted, { flex: 1, fontSize: 9 }]}>FLAT</Text>
            <Text style={[s.muted, { width: 70, textAlign: "center", fontSize: 9 }]}>ABSENT</Text>
            <Text style={[s.muted, { flex: 1, fontSize: 9 }]}>DAYS</Text>
            <Text style={[s.muted, { width: 90, textAlign: "right", fontSize: 9 }]}>PAY</Text>
          </View>
          {d.rows.length === 0 ? (
            <View style={s.tr}><Text style={s.muted}>No payroll recorded for this month.</Text></View>
          ) : (
            d.rows.map((r, i) => (
              <View key={i} style={s.tr}>
                <Text style={{ flex: 1, fontWeight: "bold" }}>{r.flat}</Text>
                <Text style={{ width: 70, textAlign: "center", color: r.absences > r.allowedHolidays ? C.warn : C.muted }}>
                  {r.absences}/{r.allowedHolidays}
                </Text>
                <Text style={[s.muted, { flex: 1 }]}>{r.absentDays.length ? r.absentDays.slice().sort((a, b) => a - b).join(", ") : "—"}</Text>
                <Text style={{ width: 90, textAlign: "right", fontWeight: "bold" }}>{formatINR(r.pay)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={s.ref}>
          <Text style={s.refText}>
            Base salary {formatINR(d.monthlySalary)}/flat · {d.allowedHolidays} free holidays · then {formatINR(d.deductionPerDay)}/extra absent day.
          </Text>
          <Text style={[s.refText, { marginTop: 4 }]}>Fixed monthly salary — the same whether the month has 30 or 31 days.</Text>
        </View>
      </Page>
    </Document>
  );
}
