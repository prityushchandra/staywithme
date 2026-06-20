"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OtpInput } from "@/components/otp-input";

const RESEND_SECONDS = 60;

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState(""); // normalized, returned by the API
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0); // seconds left before resend allowed

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {step === "phone" ? "Log in or sign up" : "Enter your coupon code"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "phone" ? (
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
