"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildWhatsAppLink, type InquiryDetails } from "@/lib/whatsapp";

// The GLOBAL, locked contact channel. The number is passed in from
// PlatformSettings (server-side) — there is no host-editable contact field
// anywhere, so this always routes to the platform WhatsApp number.
export function WhatsAppContactButton({
  whatsappNumber,
  details,
  className,
  label = "Contact on WhatsApp",
  variant = "whatsapp",
}: {
  whatsappNumber: string;
  details: InquiryDetails;
  className?: string;
  label?: string;
  /** "whatsapp" = green WhatsApp style; "brand" = the platform's Reserve style. */
  variant?: "whatsapp" | "brand";
}) {
  const href = buildWhatsAppLink(whatsappNumber, details);
  const brand = variant === "brand";

  function trackClick() {
    // Best-effort WHATSAPP_CLICK beacon; never blocks navigation.
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "WHATSAPP_CLICK", listingId: details.propertyId }),
      keepalive: true,
    }).catch(() => {});
  }

  return (
    <Button
      asChild
      size="lg"
      variant={brand ? "brand" : "default"}
      className={className}
      style={brand ? undefined : { backgroundColor: "#25D366", color: "white" }}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={trackClick}>
        <MessageCircle className="h-5 w-5" />
        {label}
      </a>
    </Button>
  );
}
