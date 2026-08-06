import React from "react";
import { Document, Page, View, Text, StyleSheet, type DocumentProps } from "@react-pdf/renderer";
import { formatINR } from "@/lib/pricing";
import { registerReceiptFonts, RECEIPT_FONT } from "@/lib/receipt-fonts";

registerReceiptFonts();

export interface BookingReceiptData {
  number: string;
  createdAt: Date;
  guestName: string;
  guestPhone: string | null;
  flat: string;
  city: string;
  checkIn: Date;
  checkOut: Date;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number;
  guests: number;
  totalPrice: number;
  amountPaid: number;
  due: number;
  source: string;
  wifiName: string | null;
  wifiPassword: string | null;
  policyTitle: string;
  policyDescription: string;
  smartLockNote: string;
  whatsappNumber: string;
}

const C = { brand: "#C8705E", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", soft: "#f9fafb", due: "#b91c1c" };

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: RECEIPT_FONT, fontSize: 11, color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", backgroundColor: C.ink, borderRadius: 12, padding: 18, marginBottom: 14 },
  brand: { fontSize: 22, fontWeight: "bold", color: C.brand },
  hTitle: { fontSize: 13, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  num: { fontSize: 12, fontWeight: "bold", color: "#ffffff", textAlign: "right" },
  hDate: { fontSize: 9, color: "#d1d5db", textAlign: "right", marginTop: 3 },
  label: { fontSize: 8, color: C.muted, letterSpacing: 1, marginBottom: 4 },
  big: { fontSize: 14, fontWeight: "bold" },
  muted: { color: C.muted },
  card: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  section: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginBottom: 10 },
  secLabel: { fontSize: 8, color: C.muted, letterSpacing: 1, marginBottom: 8 },
  dateBox: { flex: 1, backgroundColor: C.soft, borderRadius: 8, padding: 10 },
  kv: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  payBox: { backgroundColor: C.soft, borderRadius: 8, padding: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: C.line, marginTop: 6, marginBottom: 6 },
  note: { backgroundColor: "#fff7ed", borderRadius: 10, padding: 12, marginTop: 2 },
  noteText: { color: "#7c2d12", fontSize: 10, lineHeight: 1.4 },
});

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function BookingReceiptPdf(d: BookingReceiptData): React.ReactElement<DocumentProps> {
  return (
    <Document title={`Receipt ${d.number}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>StayWithMe</Text>
            <Text style={s.hTitle}>Booking Receipt{d.source === "AIRBNB" ? " · Airbnb" : ""}</Text>
          </View>
          <View>
            <Text style={s.num}>{d.number}</Text>
            <Text style={s.hDate}>{fmtDate(d.createdAt)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", marginBottom: 10 }}>
          <View style={[s.card, { marginRight: 10 }]}>
            <Text style={s.label}>GUEST</Text>
            <Text style={s.big}>{d.guestName}</Text>
            <Text style={[s.muted, { marginTop: 3 }]}>{d.guestPhone || "Phone not provided"}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.label}>STAY</Text>
            <Text style={s.big}>{d.flat}</Text>
            <Text style={[s.muted, { marginTop: 3 }]}>{d.city}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.secLabel}>DATES</Text>
          <View style={{ flexDirection: "row" }}>
            <View style={[s.dateBox, { marginRight: 10 }]}>
              <Text style={s.muted}>Check-in</Text>
              <Text style={{ fontSize: 13, fontWeight: "bold", marginTop: 3 }}>{fmtDate(d.checkIn)}</Text>
              <Text style={{ marginTop: 2 }}>{d.checkInTime || "—"}</Text>
            </View>
            <View style={s.dateBox}>
              <Text style={s.muted}>Check-out</Text>
              <Text style={{ fontSize: 13, fontWeight: "bold", marginTop: 3 }}>{fmtDate(d.checkOut)}</Text>
              <Text style={{ marginTop: 2 }}>{d.checkOutTime || "—"}</Text>
            </View>
          </View>
          <View style={s.kv}>
            <Text style={s.muted}>{d.nights} night{d.nights === 1 ? "" : "s"}</Text>
            <Text style={s.muted}>{d.guests} guest{d.guests === 1 ? "" : "s"}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.secLabel}>PAYMENT</Text>
          <View style={s.payBox}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.muted}>Total</Text>
              <Text style={{ fontWeight: "bold" }}>{formatINR(d.totalPrice)}</Text>
            </View>
            <View style={s.kv}>
              <Text style={s.muted}>Paid</Text>
              <Text style={{ fontWeight: "bold" }}>{formatINR(d.amountPaid)}</Text>
            </View>
            <View style={s.divider} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "bold" }}>Due</Text>
              <Text style={{ fontWeight: "bold", color: d.due > 0 ? C.due : C.ink }}>{formatINR(d.due)}</Text>
            </View>
          </View>
        </View>

        {d.wifiName ? (
          <View style={s.section}>
            <Text style={s.secLabel}>WIFI</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <Text style={s.muted}>Network</Text>
                <Text style={{ fontWeight: "bold", marginTop: 2 }}>{d.wifiName}</Text>
              </View>
              <View>
                <Text style={[s.muted, { textAlign: "right" }]}>Password</Text>
                <Text style={{ fontWeight: "bold", marginTop: 2, textAlign: "right" }}>{d.wifiPassword || "—"}</Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.secLabel}>CANCELLATION POLICY</Text>
          <Text style={{ fontSize: 12, fontWeight: "bold" }}>{d.policyTitle}</Text>
          <Text style={[s.muted, { marginTop: 4, lineHeight: 1.4 }]}>{d.policyDescription}</Text>
        </View>

        <View style={s.note}>
          <Text style={s.noteText}>{d.smartLockNote}</Text>
          <Text style={[s.noteText, { fontWeight: "bold", marginTop: 5 }]}>Questions? WhatsApp {d.whatsappNumber}</Text>
        </View>
      </Page>
    </Document>
  );
}
