import { KeyRound, LogOut, MessageCircle, Phone } from "lucide-react";
import {
  buildGuestMessages,
  guestPhoneDigits,
  guestWhatsAppHref,
  type GuestMessageListing,
} from "@/lib/guest-messages";

export function GuestContactActions({
  phone,
  guestName,
  status,
  listing,
}: {
  phone: string | null;
  guestName: string | null;
  status: string;
  listing: GuestMessageListing;
}) {
  const digits = guestPhoneDigits(phone);
  if (!digits) {
    return (
      <p className="text-xs text-muted-foreground">
        A valid guest phone number is needed for calls and WhatsApp.
      </p>
    );
  }

  const messages = status === "CONFIRMED" ? buildGuestMessages(guestName, listing) : null;
  const actionClass =
    "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition hover:brightness-110";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`tel:+${digits}`} className={`${actionClass} bg-sky-600 text-white`}>
        <Phone className="h-3.5 w-3.5" /> Call
      </a>
      {messages && (
        <>
          <a
            href={guestWhatsAppHref(phone, messages.onboard) ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={`${actionClass} bg-green-600 text-white`}
            title="Open the guest's welcome message in WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Onboard
          </a>
          <a
            href={guestWhatsAppHref(phone, messages.checkout) ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={`${actionClass} border bg-background`}
            title="Open the guest's checkout reminder in WhatsApp"
          >
            <LogOut className="h-3.5 w-3.5" /> Checkout reminder
          </a>
          <a
            href={guestWhatsAppHref(phone, messages.doorPin) ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={`${actionClass} border bg-background`}
            title="Open WhatsApp, then fill in the door PIN before sending"
          >
            <KeyRound className="h-3.5 w-3.5" /> Door PIN
          </a>
        </>
      )}
    </div>
  );
}
