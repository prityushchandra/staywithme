"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ManagedListing = { id: string; title: string; isVisible: boolean };
type ListingControls = {
  isAdmin: boolean;
  listings: ManagedListing[];
  pending: ReadonlySet<string>;
  errors: Record<string, string>;
  toggle: (listing: ManagedListing) => Promise<void>;
};

const ControlsContext = createContext<ListingControls | null>(null);

function isManagedListing(value: unknown): value is ManagedListing {
  return !!value && typeof value === "object" &&
    "id" in value && typeof value.id === "string" &&
    "title" in value && typeof value.title === "string" &&
    "isVisible" in value && typeof value.isVisible === "boolean";
}

function responseError(body: unknown, fallback: string): string {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error : fallback;
}

export function HomepageListingManager({
  listingIds, children,
}: {
  listingIds: string[];
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;
  const [listings, setListings] = useState<ManagedListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isAdmin) {
      setListings([]);
      setLoadError("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    setLoading(true);
    setLoadError("");
    async function load() {
      try {
        const response = await fetch("/api/admin/listings/visibility", {
          cache: "no-store", signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(body, "Could not load listing controls."));
        if (!body || typeof body !== "object" || !("listings" in body) ||
            !Array.isArray(body.listings) || !body.listings.every(isManagedListing)) {
          throw new Error("The server did not return listing visibility. Please retry.");
        }
        if (active) setListings(body.listings);
      } catch (error) {
        if (active) setLoadError(controller.signal.aborted
          ? "Loading listing controls timed out. Please retry."
          : error instanceof Error ? error.message : "Could not load listing controls.");
      } finally {
        clearTimeout(timer);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isAdmin, version]);

  async function toggle(listing: ManagedListing) {
    if (!isAdmin || inFlight.current.has(listing.id)) return;
    inFlight.current.add(listing.id);
    setPending(new Set(inFlight.current));
    setErrors((current) => ({ ...current, [listing.id]: "" }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(listing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setVisibility", visible: !listing.isVisible }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Could not update listing visibility. Please retry."));
      if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true ||
          !("isVisible" in body) || typeof body.isVisible !== "boolean") {
        throw new Error("The server did not confirm the visibility change. Please retry.");
      }
      const visible = body.isVisible;
      setListings((current) => current.map((item) => item.id === listing.id ? { ...item, isVisible: visible } : item));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [listing.id]: controller.signal.aborted
          ? "The request timed out. Refresh or retry to confirm visibility."
          : error instanceof Error ? error.message : "Could not update listing visibility. Please retry.",
      }));
    } finally {
      clearTimeout(timer);
      inFlight.current.delete(listing.id);
      setPending(new Set(inFlight.current));
    }
  }

  const gridIds = new Set(listingIds);
  const otherListings = listings.filter((listing) => !gridIds.has(listing.id));

  return (
    <ControlsContext.Provider value={{ isAdmin, listings, pending, errors, toggle }}>
      {isAdmin && loading && <p role="status" className="text-xs text-muted-foreground">Loading listing controls...</p>}
      {isAdmin && loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 p-3 text-sm">
          <p>{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setVersion((current) => current + 1)}>Retry controls</Button>
        </div>
      )}
      {children}
      {isAdmin && otherListings.length > 0 && (
        <section aria-label="Other published listings" className="mt-8 space-y-3 rounded-xl border border-dashed p-4">
          <div>
            <h2 className="text-lg font-semibold">Other listings <span className="text-xs font-normal text-muted-foreground">Admin only</span></h2>
            <p className="text-sm text-muted-foreground">Hidden stays remain here so you can show them again. Bookings and blocked dates are not changed.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {otherListings.map((listing) => (
              <article key={listing.id} className="min-w-0 rounded-xl border bg-card p-4">
                <a href={`/listings/${listing.id}`} className="break-words text-sm font-medium hover:underline">{listing.title}</a>
                <HomepageListingToggle listingId={listing.id} />
              </article>
            ))}
          </div>
        </section>
      )}
    </ControlsContext.Provider>
  );
}

export function HomepageListingToggle({ listingId }: { listingId: string }) {
  const controls = useContext(ControlsContext);
  if (!controls?.isAdmin) return null;
  const listing = controls.listings.find((item) => item.id === listingId);
  if (!listing) return null;
  const busy = controls.pending.has(listingId);
  return (
    <div className="mt-3 space-y-1.5">
      <button
        type="button"
        role="switch"
        aria-label={`Show ${listing.title} to guests`}
        aria-checked={listing.isVisible}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void controls.toggle(listing)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-left transition hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium">{listing.isVisible ? "Visible to guests" : "Hidden from guests"}</span>
          <span className="block text-[11px] text-muted-foreground">Homepage &amp; search</span>
        </span>
        {busy ? <Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin" /> : (
          <span aria-hidden="true" className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${listing.isVisible ? "bg-brand" : "bg-muted-foreground/40"}`}>
            <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${listing.isVisible ? "translate-x-5" : "translate-x-0"}`} />
          </span>
        )}
      </button>
      {controls.errors[listingId] && <p role="alert" className="text-xs text-destructive">{controls.errors[listingId]}</p>}
    </div>
  );
}
