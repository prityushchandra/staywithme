"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MessageCircle, ShieldCheck } from "lucide-react";

type Step = "intro" | "wa" | "name";

// Anchor styled like the brand button — used so a single real tap can both open
// WhatsApp (the href) and advance the flow (onClick). A programmatic open after
// an async call would be popup-blocked / need a second tap.
const brandLink =
  "inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 ease-ios hover:brightness-110 active:scale-[0.98]";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  const [step, setStep] = useState<Step>("intro");
  const [waToken, setWaToken] = useState("");
  const [waCode, setWaCode] = useState("");
  const [waLink, setWaLink] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Pre-fetch a login on mount so the "Continue" button is a ready-to-tap link
  // (one touch → WhatsApp opens). Cheap rows, 5-min TTL, auto-cleaned.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/wa-login/start", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (active && res.ok) {
          setWaToken(data.token);
          setWaCode(data.code);
          setWaLink(data.waLink);
        }
      } catch {
        /* show a retry path below */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Mint the session from the verified, single-use token (with a name for a
  // first-time user).
  async function complete(extra: Record<string, string> = {}) {
    const res = await signIn("wa", { token: waToken, ...extra, redirect: false });
    if (res?.error) {
      setError("Could not complete sign-in. Please try again.");
      setStep("intro");
      return false;
    }
    router.push(callbackUrl);
    router.refresh();
    return true;
  }

  // Poll while waiting on the WhatsApp confirmation. New users → name step;
  // returning users are signed straight in.
  useEffect(() => {
    if (step !== "wa" || !waToken) return;
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/auth/wa-login/status?token=${encodeURIComponent(waToken)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (data.status === "verified") {
          clearInterval(id);
          if (data.needsProfile) setStep("name");
          else await complete();
        } else if (data.status === "expired" || data.status === "unknown") {
          clearInterval(id);
          setError("That sign-in request expired. Please try again.");
          setStep("intro");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, waToken]);

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    await complete({ firstName: firstName.trim(), lastName: lastName.trim() });
    setLoading(false);
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-5 py-7 duration-300 animate-in fade-in-50">
        {step === "intro" && (
          <div className="space-y-6 text-center">
            {/* Animated WhatsApp badge */}
            <div className="relative mx-auto grid h-20 w-20 place-items-center">
              <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-brand/20" />
              <span className="absolute inline-flex h-20 w-20 rounded-full bg-brand/10" />
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand-gradient text-white shadow-lg">
                <MessageCircle className="h-8 w-8" />
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">
                Sign in with one tap
              </h1>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                StayWithMe runs on WhatsApp. No passwords, no codes to type — just
                confirm once from your number and you&apos;re in.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className={brandLink}
                onClick={() => {
                  setError("");
                  setStep("wa");
                }}
              >
                <MessageCircle className="h-4 w-4" />
                Continue with WhatsApp
              </a>
            ) : (
              <Button variant="brand" className="w-full" disabled>
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
              </Button>
            )}

            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Verified by your WhatsApp number — private &amp; secure.
            </p>
          </div>
        )}

        {step === "wa" && (
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
                In the chat we opened, just press <strong>send</strong> — then come
                back here. We&apos;ll log you in automatically.
              </p>
            </div>

            <div className="rounded-xl border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">Your sign-in code</p>
              <p className="text-2xl font-bold tracking-[0.3em] text-brand">{waCode}</p>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your
              confirmation…
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-2">
              <a href={waLink} target="_blank" rel="noreferrer" className="block text-sm font-medium text-brand hover:underline">
                Didn&apos;t open? Tap to open WhatsApp
              </a>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("intro");
                  setError("");
                }}
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {step === "name" && (
          <form onSubmit={submitName} className="space-y-5">
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
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  autoFocus
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
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
              disabled={loading || firstName.trim().length === 0}
            >
              {loading ? "Finishing…" : "Finish & continue"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
