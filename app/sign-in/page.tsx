"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageCircle } from "lucide-react";

type Step = "intro" | "wa" | "name";

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

  // Mint the session from the verified, single-use token (optionally with the
  // name collected for a first-time user).
  async function complete(extra: Record<string, string> = {}) {
    const res = await signIn("wa", { token: waToken, ...extra, redirect: false });
    if (res?.error) {
      setError("Could not complete sign-in. Please try again.");
      setStep("intro");
      setWaToken("");
      return false;
    }
    router.push(callbackUrl);
    router.refresh();
    return true;
  }

  // Start a WhatsApp login: get a code + deep link and move to the waiting panel.
  async function startWhatsApp() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/wa-login/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start WhatsApp sign-in. Please try again.");
        return;
      }
      setWaToken(data.token);
      setWaCode(data.code);
      setWaLink(data.waLink);
      setStep("wa");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Poll while waiting on the WhatsApp confirmation. New users go to the name
  // step; returning users are signed straight in.
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
          if (data.needsProfile) {
            setStep("name");
          } else {
            await complete();
          }
        } else if (data.status === "expired" || data.status === "unknown") {
          clearInterval(id);
          setError("That sign-in request expired. Please try again.");
          setStep("intro");
          setWaToken("");
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {step === "name" ? "Almost there — your name" : "Log in or sign up"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "intro" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              StayWithMe runs on WhatsApp. Verify in one tap from your WhatsApp
              number — no passwords, no codes to type.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="button"
              variant="brand"
              className="w-full"
              disabled={loading}
              onClick={startWhatsApp}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              Continue with WhatsApp
            </Button>
          </div>
        )}

        {step === "wa" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Tap below to open WhatsApp with a pre-filled message — just press{" "}
              <strong>send</strong>, then come back to this screen.
            </p>

            <a href={waLink} target="_blank" rel="noreferrer" className="block">
              <Button type="button" variant="brand" className="w-full">
                <MessageCircle className="h-4 w-4" />
                Open WhatsApp to confirm
              </Button>
            </a>

            <div className="rounded-xl border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">Your sign-in code</p>
              <p className="text-2xl font-bold tracking-[0.3em] text-brand">{waCode}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                It should match the message you send.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your WhatsApp
              confirmation…
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStep("intro");
                setError("");
                setWaToken("");
              }}
            >
              ← Back
            </button>
          </div>
        )}

        {step === "name" && (
          <form onSubmit={submitName} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You&apos;re verified! Tell us your name to finish setting up your
              account.
            </p>
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
