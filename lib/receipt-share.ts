export const BOOKING_RECEIPT_MESSAGE = "Please find the booking confirmation receipt for your reference.";

export function bookingReceiptFileName(guestName: string, checkIn: Date): string {
  const name = guestName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "guest";
  return `booking_receipt_${name}_${checkIn.toISOString().slice(0, 10)}.pdf`;
}

export async function fetchReceiptFile(receiptUrl: string, fileName: string, signal: AbortSignal): Promise<File> {
  const response = await fetch(receiptUrl, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not prepare the receipt. Please try again.");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mime !== "application/pdf") throw new Error("The server did not return a PDF receipt. Please try again.");
  const blob = await response.blob();
  if (await blob.slice(0, 5).text() !== "%PDF-") {
    throw new Error("The receipt PDF is invalid. Please try again.");
  }
  return new File([blob], fileName, { type: "application/pdf" });
}
