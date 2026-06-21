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

export function Navbar({ showSignature = true }: { showSignature?: boolean }) {
  const { data: session } = useSession();
  const router = useRouter();
  const user = session?.user;
  const firstName = user?.firstName ?? user?.name?.split(" ")[0] ?? null;
  // Only show the hosting dashboard once they've actually listed a property
  // (the HOST role is granted on first listing).
  const isHostUser = !!user?.roles?.includes("HOST");

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
          <Link
            href="/sign-in"
            className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 ease-ios hover:brightness-110 active:scale-[0.97]"
          >
            Get started
          </Link>
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
