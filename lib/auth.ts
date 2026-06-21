import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { authConfig } from "@/auth.config";
import { normalizePhone, consumeVerifiedOtp } from "./otp";
import { consumeWaLogin } from "./wa-login";

// Node-runtime providers. Sign-in is by phone + a one-time code: the OTP is
// generated/verified by the /api/auth/otp/* routes, and this provider trusts a
// freshly-verified (single-use) code to mint the session.
const providers: Provider[] = [
  Credentials({
    id: "phone",
    name: "Phone",
    credentials: { phone: { label: "Phone", type: "text" } },
    async authorize(raw) {
      const phone = normalizePhone(String(raw?.phone ?? ""));
      if (!phone) return null;

      // Single-use: a verified, unconsumed code must exist for this number.
      if (!(await consumeVerifiedOtp(phone))) return null;

      let user = await prisma.user.findUnique({ where: { phone } });

      // Bootstrap the admin on first login from the configured admin number,
      // so platform access never depends on a re-seed.
      if (!user && process.env.ADMIN_PHONE && phone === normalizePhone(process.env.ADMIN_PHONE)) {
        user = await prisma.user.create({
          data: { phone, name: "Platform Admin", roles: ["GUEST"], isAdmin: true },
        });
      }

      if (!user || user.suspended) return null; // unknown or suspended → no session
      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
  // WhatsApp "tap-to-verify": the user proved possession of their number by
  // sending a code from it (the webhook stamped the login VERIFIED with that
  // verified sender). We consume that single-use record and mint the session for
  // THAT phone. A brand-new number gets an account created on the spot.
  Credentials({
    id: "wa",
    name: "WhatsApp",
    credentials: {
      token: { label: "Token", type: "text" },
      firstName: { label: "First name", type: "text" },
      lastName: { label: "Last name", type: "text" },
    },
    async authorize(raw) {
      const token = String(raw?.token ?? "");
      if (!token) return null;
      const firstName = String(raw?.firstName ?? "").trim();
      const lastName = String(raw?.lastName ?? "").trim();

      const phone = await consumeWaLogin(token); // single-use; null unless VERIFIED
      if (!phone) return null;

      let user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        // First-ever login for this number: create the account. Names come from
        // the post-verify step; admin number is bootstrapped with admin rights.
        const isAdmin =
          !!process.env.ADMIN_PHONE && phone === normalizePhone(process.env.ADMIN_PHONE);
        const fullName =
          [firstName, lastName].filter(Boolean).join(" ") ||
          (isAdmin ? "Platform Admin" : "Guest");
        user = await prisma.user.create({
          data: {
            phone,
            firstName: firstName || null,
            lastName: lastName || null,
            name: fullName,
            roles: ["GUEST"],
            isAdmin,
          },
        });
      }

      if (user.suspended) return null;
      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    ...authConfig.callbacks,
    // Runs on Node. Hydrates roles/isAdmin into the token at sign-in and on a
    // session update() (e.g. after creating a first listing), avoiding a DB hit
    // on every request.
    async jwt({ token, user, trigger }) {
      const needsRefresh = !!user || trigger === "update";
      const userId = (user?.id as string | undefined) ?? (token.sub as string);
      if (needsRefresh && userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { roles: true, isAdmin: true, firstName: true, name: true, phone: true },
        });
        token.sub = userId;
        token.roles = dbUser?.roles ?? ["GUEST"];
        token.isAdmin = dbUser?.isAdmin ?? false;
        token.firstName = dbUser?.firstName ?? dbUser?.name ?? null;
        token.name = dbUser?.name ?? null;
        token.phone = dbUser?.phone ?? null;
      }
      return token;
    },
  },
});

export function isHost(roles: string[] | undefined): boolean {
  return !!roles?.includes("HOST");
}
