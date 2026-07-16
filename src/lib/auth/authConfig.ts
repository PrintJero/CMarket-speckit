import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";

/**
 * Only Google is registered here. Email/password sign-in/out is implemented
 * by our own routes (app/api/auth/sign-in, app/api/auth/sign-out) rather than
 * an Auth.js CredentialsProvider — see research.md #2 addendum: NextAuth v4's
 * CredentialsProvider always issues a stateless JWT session, even when
 * `session.strategy` is "database", which cannot satisfy Story 2's
 * requirement that sign-out immediately, server-side revokes access. Routing
 * credentials through our own code keeps ONE Session table and ONE
 * revocation path for both auth methods.
 */
export const authOptions: NextAuthOptions = {
  adapter: buildPrismaAuthAdapter(),
  session: {
    strategy: "database",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // FR-015: auto-link a Google sign-in to an existing email/password
      // account when the email matches, trusting Google's own verification.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
};
