import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe auth config — NO Prisma, NO bcrypt, NO Node-only imports.
// Used by middleware (Edge runtime). It only decodes the existing JWT and maps
// its claims onto the session; the heavy work (DB lookups, password checks)
// lives in lib/auth.ts which runs on Node.
const googleProviders =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [];

export const authConfig = {
  // Trust the incoming Host header. Required by Auth.js v5 outside Vercel
  // (e.g. `next start` locally, or self-hosting); without it production builds
  // throw UntrustedHost on every auth/session call. Safe behind a known host.
  trustHost: true,
  // Explicit JWT sessions so the EDGE middleware (which has no Prisma adapter)
  // decodes the session from the cookie itself. Without this, on Vercel's Edge
  // runtime the middleware can fail to resolve the session and bounce a
  // logged-in user back to /sign-in (e.g. on /admin).
  session: { strategy: "jwt" as const },
  pages: { signIn: "/sign-in" },
  providers: googleProviders,
  callbacks: {
    // Maps JWT claims (written by the Node jwt callback) onto the session.
    // Pure — safe on the Edge.
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.roles = (token.roles as string[] | undefined) ?? ["GUEST"];
        session.user.isAdmin = (token.isAdmin as boolean | undefined) ?? false;
        session.user.firstName = (token.firstName as string | null | undefined) ?? null;
        session.user.phone = (token.phone as string | null | undefined) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
