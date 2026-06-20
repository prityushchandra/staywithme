"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, Camera, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function BecomeHostPage() {
  const router = useRouter();
  const { update } = useSession();
  const [loading, setLoading] = useState(false);

  async function becomeHost() {
    setLoading(true);
    const res = await fetch("/api/host/become", { method: "POST" });
    if (res.ok) {
      await update(); // refresh JWT so HOST role is reflected immediately
      router.push("/host/listings/new");
      router.refresh();
    } else {
      setLoading(false);
    }
  }

  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-3xl font-bold tracking-tight">Become a host on StayWithMe</h1>
      <p className="mt-2 text-muted-foreground">
        List your place and reach guests. The platform handles all guest
        inquiries for you — you never share personal contact details.
      </p>

      <div className="my-8 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Home, t: "List your space", d: "Add details, photos, and your price." },
          { icon: Camera, t: "Get reviewed", d: "Admin approves before it goes live." },
          { icon: CheckCircle2, t: "Receive inquiries", d: "The platform coordinates guest inquiries for you." },
        ].map(({ icon: Icon, t, d }) => (
          <Card key={t}>
            <CardContent className="space-y-2 p-5">
              <Icon className="h-6 w-6 text-brand" />
              <p className="font-medium">{t}</p>
              <p className="text-sm text-muted-foreground">{d}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button variant="brand" size="lg" onClick={becomeHost} disabled={loading}>
        {loading ? "Setting up…" : "Start hosting"}
      </Button>
    </div>
  );
}
