"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  Home,
  Menu,
  User,
  Heart,
  LayoutDashboard,
  LogOut,
  Plus,
  type LucideIcon,
} from "lucide-react";

export function Navbar({
  showSignature = true,
  whatsappNumber,
}: {
  showSignature?: boolean;
  whatsappNumber?: string;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const user = session?.user;
  const firstName = user?.firstName ?? user?.name?.split(" ")[0] ?? null;
  // Only show the hosting dashboard once they've actually listed a property
  // (the HOST role is granted on first listing).
  const isHostUser = !!user?.roles?.includes("HOST");

  // "Book on WhatsApp" quick action — opens WhatsApp with a ready-to-send note.
  const waDigits = (whatsappNumber || "+918789194107").replace(/\D/g, "");
  const waHref = `https://wa.me/${waDigits}?text=${encodeURIComponent(
    "Hi Chandra! I would like to book a stay with you."
  )}`;

  async function handleSignOut() {
    close();
    // Clear the session via the API (no NextAuth full-page redirect — that can
    // bounce to the wrong host on LAN/mobile), then navigate home ourselves.
    await signOut({ redirect: false });
    router.push("/");
    router.refresh();
  }

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-brand">
          <Home className="h-6 w-6 shrink-0" />
          {showSignature ? (
            <span className="flex flex-col leading-none">
              <span className="text-lg">StayWithMe</span>
              {/* A playful signature in mirror writing — readable only in a mirror. */}
              <span
                className="mt-0.5 text-[13px] font-normal text-brand/70"
                style={{
                  fontFamily: "'Segoe Script','Brush Script MT',cursive",
                  transform: "scaleX(-1)",
                  display: "inline-block",
                }}
                aria-hidden="true"
                title="by chandra"
              >
                by chandra
              </span>
            </span>
          ) : (
            // Signature off: wordmark sits centred against the logo.
            <span className="text-lg leading-none">StayWithMe</span>
          )}
        </Link>

        {/* Logged out: a single entry point — sign-in figures out log in vs sign up. */}
        {!user ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Book a stay on WhatsApp"
              className="wa-cta group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-[#25D366] to-[#075E54] px-3.5 py-2.5 text-sm font-semibold text-white transition-transform duration-200 ease-ios hover:scale-[1.04] active:scale-[0.97]"
            >
              <span className="wa-shine" aria-hidden="true" />
              <WhatsAppGlyph className="relative z-[1] h-[18px] w-[18px] shrink-0" />
              <span className="relative z-[1] hidden sm:inline">WhatsApp</span>
            </a>
            <Link
              href="/sign-in"
              className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 ease-ios hover:brightness-110 active:scale-[0.97]"
            >
              Get started
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Anyone can host */}
            <Link
              href="/host/listings/new"
              className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-muted sm:block"
            >
              List your property
            </Link>

            <span className="hidden text-sm text-muted-foreground sm:inline">
              Hi, <span className="font-medium text-foreground">{firstName ?? "there"}</span>
            </span>

            {/* Profile menu */}
            <div ref={ref} className="relative">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Menu"
                aria-expanded={open}
                className="flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 shadow-sm transition duration-200 ease-ios hover:shadow-md active:scale-[0.97]"
              >
                <Menu className="h-4 w-4" />
                <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-foreground text-background">
                  <span className="text-xs font-semibold">
                    {(firstName ?? user.name ?? "U").charAt(0).toUpperCase()}
                  </span>
                </span>
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-2 w-60 origin-top-right overflow-hidden rounded-2xl border bg-background py-2 shadow-xl duration-200 ease-ios animate-in fade-in zoom-in-95 slide-in-from-top-1">
                  <div className="px-4 py-2">
                    <p className="truncate text-sm font-semibold">
                      Hi, {firstName ?? "there"}
                    </p>
                    {user.email && (
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    )}
                  </div>
                  <div className="my-1 border-t" />
                  <MenuLink href="/account" Icon={User} onClick={close}>
                    Account
                  </MenuLink>
                  <MenuLink href="/host/listings/new" Icon={Plus} onClick={close}>
                    List your property
                  </MenuLink>
                  {isHostUser && (
                    <MenuLink href="/host" Icon={Home} onClick={close}>
                      Hosting dashboard
                    </MenuLink>
                  )}
                  <MenuLink href="/wishlists" Icon={Heart} onClick={close}>
                    Wishlist
                  </MenuLink>
                  {user.isAdmin && (
                    <MenuLink href="/admin" Icon={LayoutDashboard} onClick={close}>
                      Admin
                    </MenuLink>
                  )}
                  <div className="my-1 border-t" />
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuLink({
  href,
  children,
  onClick,
  Icon,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
  Icon?: LucideIcon;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted"
    >
      {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      <span>{children}</span>
    </Link>
  );
}

// WhatsApp brand glyph (lucide has no brand icons).
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
