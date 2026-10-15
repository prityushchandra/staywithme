"use client";

import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";

const MESSAGE = "Hi chandra, I want to book your property.";

/**
 * Floating "Contact us" WhatsApp button, shown on every page whether or not
 * the visitor is signed in. It hides itself on listing pages, where the fixed
 * mobile booking tab already owns the bottom-right corner, and inside the
 * admin/host dashboards where it would just be in the way.
 */
export function ContactUsButton({ whatsappNumber }: { whatsappNumber: string }) {
  const pathname = usePathname() ?? "/";

  // The dashboards are work surfaces, not sales surfaces.
  if (pathname.startsWith("/admin") || pathname.startsWith("/host")) return null;

  // On a listing page the fixed mobile booking tab already owns the bottom of
  // the screen, so only show this once that tab is gone (lg and up).
  const onListing = /^\/listings\/[^/]+$/.test(pathname);

  const digits = whatsappNumber.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const number = digits.length === 10 ? `91${digits}` : digits;

  return (
    <a
      href={`https://wa.me/${number}?text=${encodeURIComponent(MESSAGE)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contact us on WhatsApp"
      className={`group fixed bottom-[calc(env(safe-area-inset-bottom)_+_1rem)] right-4 z-40 items-center gap-2 rounded-full bg-[#25D366] py-3 pl-3.5 pr-4 text-sm font-semibold text-white shadow-lg shadow-black/20 transition duration-200 ease-ios hover:brightness-105 active:scale-95 sm:bottom-6 sm:right-6 ${
        onListing ? "hidden lg:flex" : "flex"
      }`}
    >
      <MessageCircle className="h-5 w-5 shrink-0" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-ios group-hover:max-w-[7rem] group-hover:opacity-100 sm:max-w-[7rem] sm:opacity-100">
        Contact us
      </span>
    </a>
  );
}
