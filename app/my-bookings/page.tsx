import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  MessageCircle,
  Phone,
  XCircle,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp";
import { formatINR } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "My bookings" };
export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function nights(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

const STATUS: Record<
  string,
  { label: string; variant: "warning" | "success" | "destructive" | "secondary"; blurb: string }
> = {
  AWAITING_APPROVAL: {
    label: "Awaiting approval",
    variant: "warning",
    blurb: "We've received your payment and your dates are held. You'll hear from us shortly.",
  },
  CONFIRMED: {
    label: "Confirmed",
    variant: "success",
    blurb: "You're all set. Download your receipt below and message us any time.",
  },
  CANCELLED: {
    label: "Cancelled",
    variant: "destructive",
    blurb: "This booking was cancelled. Reach out to us if you think that's a mistake.",
  },
  PENDING: {
    label: "Pending",
    variant: "secondary",
    blurb: "This request hasn't been confirmed yet.",
  },
};

export default async function MyBookingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in?callbackUrl=/my-bookings");

  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({
      where: {
        guestId: session.user.id,
        // Abandoned "book with us" drafts never became bookings — nothing was
        // paid and no dates are held, so showing them would only confuse.
        NOT: { source: "ONLINE", status: "PENDING" },
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            checkInTime: true,
            checkOutTime: true,
            images: { select: { url: true }, orderBy: [{ isCover: "desc" }, { order: "asc" }], take: 1 },
          },
        },
      },
      orderBy: { checkIn: "desc" },
      take: 50,
    }),
    getPlatformSettings(),
  ]);

  const wa = normalizeWhatsAppNumber(settings.whatsappNumber);
  const tel = wa ? `+${wa}` : null;

  return (
    <div className="container max-w-3xl py-10">
      <h1 className="text-2xl font-bold tracking-tight">My bookings</h1>
      <p className="mt-1 text-muted-foreground">
        Every stay you&apos;ve booked with us, with receipts and a direct line to the host.
      </p>

      {bookings.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed bg-card p-10 text-center">
          <CalendarDays className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 font-semibold">No bookings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When you book a stay it will show up here with your receipt.
          </p>
          <Link
            href="/search"
            className="mt-5 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Browse stays
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {bookings.map((b) => {
            const meta = STATUS[b.status] ?? STATUS.PENDING;
            const photo = b.listing.images[0]?.url;
            const canDownload = b.publicToken && b.status !== "CANCELLED" && b.amountPaid > 0;
            const waText = encodeURIComponent(
              `Hi, this is about my booking #${b.id.slice(-6)} at ${b.listing.title} (${fmt(
                b.checkIn,
              )} → ${fmt(b.checkOut)}).`,
            );
            return (
              <div key={b.id} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="flex gap-4 p-4 sm:p-5">
                  <Link
                    href={`/listings/${b.listing.id}`}
                    className="relative hidden h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:block"
                  >
                    {photo && (
                      <Image
                        src={photo}
                        alt={b.listing.title}
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                    )}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/listings/${b.listing.id}`}
                        className="break-words font-semibold leading-tight hover:underline"
                      >
                        {b.listing.title}
                      </Link>
                      <Badge variant={meta.variant}>
                        {b.status === "CONFIRMED" ? (
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                        ) : b.status === "CANCELLED" ? (
                          <XCircle className="mr-1 h-3 w-3" />
                        ) : (
                          <Clock className="mr-1 h-3 w-3" />
                        )}
                        {meta.label}
                      </Badge>
                    </div>

                    <p className="mt-1.5 text-sm">
                      <span className="font-medium">{fmt(b.checkIn)}</span>
                      <span className="text-muted-foreground"> ({b.listing.checkInTime}) → </span>
                      <span className="font-medium">{fmt(b.checkOut)}</span>
                      <span className="text-muted-foreground"> ({b.listing.checkOutTime})</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {nights(b.checkIn, b.checkOut)} night
                      {nights(b.checkIn, b.checkOut) > 1 ? "s" : ""} · {b.guests} guest
                      {b.guests > 1 ? "s" : ""} ·{" "}
                      <span className="font-mono text-xs">#{b.id.slice(-6)}</span>
                    </p>

                    {b.amountPaid > 0 && (
                      <p className="mt-1 text-sm font-semibold text-green-600">
                        {formatINR(b.amountPaid)} paid
                      </p>
                    )}

                    <p className="mt-2 text-xs text-muted-foreground">{meta.blurb}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {canDownload && (
                        <a
                          href={`/api/receipts/booking/${b.id}?t=${b.publicToken}&download=1`}
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:border-foreground"
                        >
                          <Download className="h-3.5 w-3.5" /> Receipt
                        </a>
                      )}
                      {tel && (
                        <a
                          href={`tel:${tel}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
                        >
                          <Phone className="h-3.5 w-3.5" /> Call host
                        </a>
                      )}
                      {wa && (
                        <a
                          href={`https://wa.me/${wa}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
                        >
                          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
