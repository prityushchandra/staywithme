import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Edge-safe auth instance (no Prisma) — only decodes the JWT.
const { auth } = NextAuth(authConfig);

const VISITOR_COOKIE = "swm_vid";
const ONE_YEAR = 60 * 60 * 24 * 365;

// Attach an anonymous first-party visitor id to the response if the browser
// doesn't already carry one. httpOnly so page scripts can't read/spoof it; the
// /api/track/visit route reads it server-side to count real visitors who land
// and browse without signing up.
function ensureVisitorId(res: NextResponse, current: string | undefined): NextResponse {
  if (!current) {
    res.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_YEAR,
      path: "/",
    });
  }
  return res;
}

// Route protection: /host/* and /account/* require sign-in (any user can host),
// /admin/* requires isAdmin. Runs on all page routes so every visitor also gets
// a visitor-id cookie for traffic analytics.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const currentVid = req.cookies.get(VISITOR_COOKIE)?.value;

  const needsAuth =
    pathname.startsWith("/host") || pathname.startsWith("/account");
  const needsAdmin = pathname.startsWith("/admin");

  if (needsAuth || needsAdmin) {
    if (!user) {
      const url = new URL("/sign-in", req.nextUrl);
      url.searchParams.set("callbackUrl", pathname);
      return ensureVisitorId(NextResponse.redirect(url), currentVid);
    }
    if (needsAdmin && !user.isAdmin) {
      return ensureVisitorId(NextResponse.redirect(new URL("/", req.nextUrl)), currentVid);
    }
  }

  return ensureVisitorId(NextResponse.next(), currentVid);
});

export const config = {
  // Run on all page routes (to set the visitor cookie + guard protected areas)
  // except API routes, Next internals, and any path with a file extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
