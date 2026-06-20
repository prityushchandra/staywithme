import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: string[];
      isAdmin: boolean;
      firstName?: string | null;
      phone?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: string[];
    isAdmin?: boolean;
    firstName?: string | null;
    phone?: string | null;
  }
}
