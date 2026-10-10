import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PhoneSignIn } from "@/components/auth/phone-sign-in";

export const dynamic = "force-dynamic";

// Only an internal, same-origin path is an acceptable destination — an absolute
// or protocol-relative URL would be an open-redirect phishing vector.
function safeCallback(raw: string | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // Already signed in? Skip the form entirely and send them where they were
  // headed — reopening the app feels "already logged in" instead of dumping a
  // returning guest back on a sign-in screen.
  const [session, sp] = await Promise.all([auth(), searchParams]);
  if (session?.user?.id) redirect(safeCallback(sp?.callbackUrl));

  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <PhoneSignIn />
        </Suspense>
      </div>
    </div>
  );
}
