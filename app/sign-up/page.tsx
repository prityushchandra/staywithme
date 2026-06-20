"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get("phone") ?? "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // You only reach sign-up after verifying a number on the sign-in screen.
  useEffect(() => {
    if (!phone) router.replace("/sign-in");
  }, [phone, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/otp/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, firstName, lastName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoading(false);
        setError(data.error ?? "Could not create your account.");
        return;
      }

      // Account created — issue the session from the still-verified code.
      const signInRes = await signIn("phone", { phone, redirect: false });
      if (signInRes?.error) {
        setLoading(false);
        setError("Account created, but sign-in failed. Please log in again.");
        router.push("/sign-in");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setLoading(false);
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome — let&apos;s set up your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your number {phone} is verified. Tell us your name to finish.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
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
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="brand" className="w-full" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SignUpPage() {
  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <SignUpForm />
        </Suspense>
      </div>
    </div>
  );
}
