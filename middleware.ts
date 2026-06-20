import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Edge-safe auth instance (no Prisma) — only decodes the JWT.
const { auth } = NextAuth(authConfig);

// Route protection: /host/* requires sign-in (any user can host), /admin/*
// requires isAdmin.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  const needsAuth =
    pathname.startsWith("/host") || pathname.startsWith("/account");
  const needsAdmin = pathname.startsWith("/admin");
  if (!needsAuth && !needsAdmin) return NextResponse.next();

  if (!user) {
    const url = new URL("/sign-in", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (needsAdmin && !user.isAdmin) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/host/:path*", "/admin/:path*", "/account/:path*"],
};
