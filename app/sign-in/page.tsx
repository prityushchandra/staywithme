"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OtpInput } from "@/components/otp-input";
import { Loader2, MessageCircle } from "lucide-react";

const RESEND_SECONDS = 60;

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  const [step, setStep] = useState<"phone" | "otp" | "wa">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState(""); // normalized, returned by the API
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0); // seconds left before resend allowed

  // WhatsApp tap-to-verify state.
  const [waToken, setWaToken] = useState("");
  const [waCode, setWaCode] = useState("");
  const [waLink, setWaLink] = useState("");

  // Tick the resend countdown down to zero.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send the code.");
        return;
      }
      setPhone(data.phone);
      setDevCode(data.devCode ?? null);
      setCode("");
      setStep("otp");
      setResendIn(RESEND_SECONDS);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That code isn't right.");
        return;
      }

      if (data.status === "new") {
        // No account yet — collect the name on the sign-up screen.
        router.push(`/sign-up?phone=${encodeURIComponent(phone)}`);
        return;
      }

      // Existing account — issue the session from the verified code.
      const signInRes = await signIn("phone", { phone, redirect: false });
      if (signInRes?.error) {
        setError("Could not sign you in. Please request a new code.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Start WhatsApp tap-to-verify: get a code + deep link, open WhatsApp, then
  // poll until the user's message lands and we can mint the session.
  async function startWhatsApp() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/wa-login/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start WhatsApp sign-in.");
        return;
      }
      setWaToken(data.token);
      setWaCode(data.code);
      setWaLink(data.waLink);
      setStep("wa");
      window.open(data.waLink, "_blank"); // opens the WhatsApp app / web with the message pre-filled
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Poll the login status while waiting on the WhatsApp confirmation. When it
  // flips to "verified", complete sign-in with the single-use token.
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
          const signInRes = await signIn("wa", { token: waToken, redirect: false });
          if (signInRes?.error) {
            setError("Could not complete sign-in. Please try again.");
            setStep("phone");
            return;
          }
          router.push(callbackUrl);
          router.refresh();
        } else if (data.status === "expired" || data.status === "unknown") {
          clearInterval(id);
          setError("That sign-in request expired. Please try again.");
          setStep("phone");
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [step, waToken, callbackUrl, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {step === "phone"
            ? "Log in or sign up"
            : step === "wa"
              ? "Continue on WhatsApp"
              : "Enter your coupon code"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "wa" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              We opened WhatsApp with a pre-filled message to confirm it&apos;s you
              — just press <strong>send</strong> there, then come back here.
            </p>
            <div className="rounded-xl border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">Your sign-in code</p>
              <p className="text-2xl font-bold tracking-[0.3em] text-brand">{waCode}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Make sure it matches the message you send.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your WhatsApp
              confirmation…
            </div>
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-medium text-brand hover:underline"
            >
              Didn&apos;t open? Tap to open WhatsApp
            </a>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStep("phone");
                setError("");
                setWaToken("");
              }}
            >
              ← Back
            </button>
          </div>
        ) : step === "phone" ? (
          <>
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  required
                  placeholder="Enter Mobile Number"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  We&apos;ll send a coupon code over WhatsApp. Indian numbers can
                  skip the +91.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" variant="brand" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send coupon code"}
              </Button>
            </form>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={startWhatsApp}
            >
              <MessageCircle className="h-4 w-4" />
              Continue with WhatsApp
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No code to type — confirm in one tap from your WhatsApp number.
            </p>
          </>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">6-digit coupon code</Label>
              <OtpInput value={code} onChange={setCode} autoFocus />
              <p className="text-xs text-muted-foreground">Sent to {phone}.</p>
            </div>

            {devCode && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Testing mode — your coupon code is{" "}
                <span className="font-bold tracking-wider">{devCode}</span>
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              variant="brand"
              className="w-full"
              disabled={loading || code.length < 6}
            >
              {loading ? "Verifying…" : "Verify & continue"}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
              >
                ← Change number
              </button>
              <button
                type="button"
                className="font-medium text-brand disabled:opacity-50"
                disabled={loading || resendIn > 0}
                onClick={() => sendCode()}
              >
                Resend coupon code
              </button>
            </div>

            {resendIn > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Resend available in 0:{String(resendIn).padStart(2, "0")}
              </p>
            )}
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
