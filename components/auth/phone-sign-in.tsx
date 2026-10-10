"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toWhatsAppAppLink } from "@/lib/whatsapp";

type StartResp = {
  token: string;
  code: string;
  message: string;
  waLink: string;
  botNumber: string | null;
};

/** Result of the /api/auth/lookup probe — decides log-in vs sign-up copy. */
type Lookup = { exists: boolean; firstName: string | null };

type Phase = "idle" | "waiting" | "name" | "signing";

// A WhatsApp login that is mid-flight. Mobile browsers routinely discard a
// backgrounded tab's JS state while the user is away in the WhatsApp app;
// persisting lets us rebuild the "waiting" screen and resume polling on return
// instead of stranding the user on a reset sign-in form.
const PENDING_KEY = "staywithme.waLogin.v1";
const PENDING_TTL_MS = 5 * 60 * 1000; // mirrors the server-side login TTL

type Pending = StartResp & {
  phone: string;
  firstName: string;
  lastName: string;
  savedAt: number;
};

function savePending(p: Pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — non-fatal, the flow just can't resume */
  }
}

function loadPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (!p?.token || Date.now() - (p.savedAt ?? 0) > PENDING_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

// Only accept an internal, same-origin path as the post-login destination — a
// caller-supplied absolute or protocol-relative URL would be an open-redirect
// phishing vector (land on the real site, sign in, get bounced off-site).
function safeCallback(raw: string | null): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

function openWhatsApp(waLink: string) {
  const isMobile =
    typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  try {
    if (isMobile) {
      // In-place app launch via the custom scheme — this does NOT navigate the
      // tab away, so the page stays mounted and keeps polling.
      window.location.href = toWhatsAppAppLink(waLink) ?? waLink;
    } else {
      window.open(waLink, "_blank", "noopener");
    }
  } catch {
    /* the manual "Open WhatsApp" link below is always available */
  }
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

export function PhoneSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get("callbackUrl"));

  const [phase, setPhase] = React.useState<Phase>("idle");
  // Idle sub-flow: ask for the number first, look the account up, THEN show the
  // right form — log in (returning) vs sign up (new).
  const [idStep, setIdStep] = React.useState<"phone" | "profile">("phone");
  const [known, setKnown] = React.useState<Lookup | null>(null);
  const [checking, setChecking] = React.useState(false);

  const [phone, setPhone] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");

  const [start, setStart] = React.useState<StartResp | null>(null);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const signingRef = React.useRef(false);

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  React.useEffect(() => () => stopPolling(), [stopPolling]);

  const phoneOk = digitsOf(phone).length >= 10;
  // A returning account already has a name, so we only collect what's missing —
  // that's the whole "log in vs sign up" split.
  const needsName = !known || !known.exists;

  // Mint the session from the verified, single-use token. The typed number is
  // sent too so the server can refuse if the WhatsApp message came from a
  // different number (it never grants access on its own).
  const complete = React.useCallback(
    async (token: string, profile: { phone: string; firstName: string; lastName: string }) => {
      if (signingRef.current) return;
      signingRef.current = true;
      setPhase("signing");
      const res = await signIn("wa", {
        token,
        phone: profile.phone,
        firstName: profile.firstName,
        lastName: profile.lastName,
        redirect: false,
      });
      clearPending();
      if (res?.ok && !res.error) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }
      signingRef.current = false;
      setStart(null);
      setError(
        "We couldn't complete that sign-in. Make sure you send the code from the number you entered, then try again."
      );
      setPhase("idle");
      setIdStep("profile");
    },
    [callbackUrl, router]
  );

  // Verified? Either sign straight in, or collect a name first when this is a
  // brand-new number and we didn't already ask for one.
  const onVerified = React.useCallback(
    (
      needsProfile: boolean,
      token: string,
      profile: { phone: string; firstName: string; lastName: string }
    ) => {
      if (needsProfile && !profile.firstName.trim()) {
        setPhase("name");
        return;
      }
      void complete(token, profile);
    },
    [complete]
  );

  const poll = React.useCallback(
    (token: string, profile: { phone: string; firstName: string; lastName: string }) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/auth/wa-login/status?token=${encodeURIComponent(token)}`,
            { cache: "no-store" }
          );
          const data = await res.json().catch(() => ({}));
          if (data.status === "verified") {
            stopPolling();
            onVerified(!!data.needsProfile, token, profile);
          } else if (data.status === "expired" || data.status === "unknown") {
            stopPolling();
            clearPending();
            setError("That sign-in request expired. Please try again.");
            setStart(null);
            setPhase("idle");
            setIdStep("profile");
          }
        } catch {
          /* transient network hiccup — keep polling */
        }
      }, 2000);
    },
    [stopPolling, onVerified]
  );

  // Resume a login that was mid-flight when the browser discarded this page's
  // state while the user was away in WhatsApp.
  React.useEffect(() => {
    const p = loadPending();
    if (!p) return;
    setPhone(p.phone);
    setFirstName(p.firstName);
    setLastName(p.lastName);
    setStart({
      token: p.token,
      code: p.code,
      message: p.message,
      waLink: p.waLink,
      botNumber: p.botNumber,
    });
    setPhase("waiting");
    poll(p.token, { phone: p.phone, firstName: p.firstName, lastName: p.lastName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back from the WhatsApp app: background tabs get their timers
  // throttled, so re-check the moment we're visible again.
  React.useEffect(() => {
    if (phase !== "waiting" || !start) return;
    const token = start.token;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/auth/wa-login/status?token=${encodeURIComponent(token)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "verified") {
            stopPolling();
            onVerified(!!data.needsProfile, token, { phone, firstName, lastName });
          }
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase, start, phone, firstName, lastName, stopPolling, onVerified]);

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phoneOk) {
      setError("Enter a valid WhatsApp number.");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/auth/lookup?phone=${encodeURIComponent(phone.trim())}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as Lookup;
      setKnown(data);
      if (data.firstName && !firstName.trim()) setFirstName(data.firstName);
    } catch {
      // Probe failed — fall back to treating them as a new sign-up, which just
      // means we ask for a name we may not strictly need.
      setKnown({ exists: false, firstName: null });
    } finally {
      setChecking(false);
      setIdStep("profile");
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phoneOk) {
      setError("Enter a valid WhatsApp number.");
      return;
    }
    if (needsName && !firstName.trim()) {
      setError("Enter your name so we know who's staying.");
      return;
    }

    signingRef.current = false;
    setPhase("waiting");
    try {
      const res = await fetch("/api/auth/wa-login/start", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<StartResp>;
      if (!res.ok || !data.token || !data.waLink) throw new Error("start failed");
      const started = data as StartResp;
      setStart(started);
      // Persist BEFORE opening WhatsApp so a discarded tab can resume on return.
      savePending({
        ...started,
        phone,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        savedAt: Date.now(),
      });
      openWhatsApp(started.waLink);
      poll(started.token, {
        phone,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
    } catch {
      clearPending();
      setError("Couldn't reach the server. Check your connection and try again.");
      setPhase("idle");
      setIdStep("profile");
    }
  }

  async function onSubmitName(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!start) return;
    await complete(start.token, {
      phone,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    });
  }

  function reset() {
    stopPolling();
    clearPending();
    signingRef.current = false;
    setStart(null);
    setKnown(null);
    setError("");
    setPhase("idle");
    setIdStep("phone");
  }

  function copyMessage() {
    if (!start) return;
    navigator.clipboard
      ?.writeText(start.message)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-5 py-7 duration-300 animate-in fade-in-50">
        {/* ---------------- Step 1: your number ---------------- */}
        {phase === "idle" && idStep === "phone" && (
          <form onSubmit={onContinue} className="space-y-5">
            <div className="space-y-4 text-center">
              <div className="relative mx-auto grid h-20 w-20 place-items-center">
                <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-brand/20" />
                <span className="absolute inline-flex h-20 w-20 rounded-full bg-brand/10" />
                <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand-gradient text-white shadow-lg">
                  <MessageCircle className="h-8 w-8" />
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Enter your number</h1>
                <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                  We&apos;ll check if you already have a StayWithMe account — no passwords,
                  ever.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-left">
              <Label htmlFor="phone">WhatsApp number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="e.g. 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              variant="brand"
              className="w-full"
              size="lg"
              disabled={checking || !phoneOk}
            >
              {checking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  Continue <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            <p className="flex items-start justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Verified by your WhatsApp number — private &amp; secure.</span>
            </p>
          </form>
        )}

        {/* ---------------- Step 2: welcome back / create account ---------------- */}
        {phase === "idle" && idStep === "profile" && (
          <form onSubmit={onVerify} className="space-y-5">
            <button
              type="button"
              onClick={() => {
                setIdStep("phone");
                setKnown(null);
                setError("");
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {phone ? `Change number (${phone})` : "Change number"}
            </button>

            {known?.exists ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-sm font-semibold">
                  Welcome back{known.firstName ? `, ${known.firstName}` : ""}! 👋
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Confirm it&apos;s you on WhatsApp and you&apos;re straight back in.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-sm font-semibold">Create your account 🎉</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Just your name — we&apos;ll verify the number on WhatsApp.
                </p>
              </div>
            )}

            {needsName && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    autoComplete="given-name"
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" variant="brand" className="w-full" size="lg">
              <MessageCircle className="h-4 w-4" />
              {known?.exists ? "Verify with WhatsApp" : "Create account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Opens WhatsApp with a ready code — just hit send. No passwords, no codes to
              type.
            </p>
          </form>
        )}

        {/* ---------------- Step 3: waiting on WhatsApp ---------------- */}
        {phase === "waiting" && (
          <div className="space-y-5 text-center">
            <div className="relative mx-auto grid h-16 w-16 place-items-center">
              <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-brand/20" />
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand/10 text-brand">
                <MessageCircle className="h-7 w-7" />
              </span>
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Confirm on WhatsApp</h2>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                In the chat we opened, just press <strong>send</strong> — then come back
                here. We&apos;ll log you in automatically.
              </p>
            </div>

            {start && (
              <>
                <div className="rounded-xl border bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Your sign-in code</p>
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-2xl font-bold tracking-[0.3em] text-brand">
                      {start.code}
                    </p>
                    <button
                      type="button"
                      onClick={copyMessage}
                      aria-label="Copy the message to send"
                      className="text-muted-foreground transition hover:text-foreground"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-brand" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {start.botNumber && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Or send it to {start.botNumber} yourself.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your
                  confirmation…
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="space-y-2">
                  <a
                    href={start.waLink}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm font-medium text-brand hover:underline"
                  >
                    Didn&apos;t open? Tap to open WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={reset}
                    className="mx-auto flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Use a different number
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------------- Fallback: name after verifying ---------------- */}
        {phase === "name" && (
          <form onSubmit={onSubmitName} className="space-y-5">
            <div className="space-y-2 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold">You&apos;re verified!</h2>
              <p className="text-sm text-muted-foreground">
                Just your name to finish setting up your account.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="verifiedFirstName">First name</Label>
                <Input
                  id="verifiedFirstName"
                  autoFocus
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="verifiedLastName">Last name</Label>
                <Input
                  id="verifiedLastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              variant="brand"
              className="w-full"
              disabled={firstName.trim().length === 0}
            >
              Finish &amp; continue
            </Button>
          </form>
        )}

        {/* ---------------- Signing in ---------------- */}
        {phase === "signing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="text-sm text-muted-foreground">Signing you in…</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
