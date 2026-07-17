import type { NextAuthOptions, Profile } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import GoogleProvider from "next-auth/providers/google";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/sessionCookie";

/**
 * 006-user-display-names, research.md #2: when GOOGLE_OAUTH_MOCK_ENABLED is
 * "true", point the OAuth endpoints at the standalone mock server
 * (scripts/mock-google-oauth-server.ts) instead of Google's real ones —
 * never a Next.js route under app/, and never reachable unless this exact
 * env var is set to exactly "true" (unset/empty/any other value always
 * yields the real GoogleProvider below). This MUST NEVER be set in any real
 * deployment.
 */
interface MockGoogleProfile {
  sub: string;
  name?: string;
  email: string;
  picture?: string;
}

function buildGoogleProvider(): OAuthConfig<Profile> | ReturnType<typeof GoogleProvider> {
  if (process.env.GOOGLE_OAUTH_MOCK_ENABLED === "true") {
    const mockUrl = process.env.GOOGLE_OAUTH_MOCK_URL ?? "";
    return {
      id: "google",
      name: "Google",
      type: "oauth",
      clientId: process.env.GOOGLE_CLIENT_ID || "mock-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "mock-client-secret",
      // Deliberately omits "openid" from the scope: NextAuth's own provider
      // normalization (core/lib/providers.js) infers `idToken: true` from an
      // "openid" scope or a wellKnown URL, which would force the OIDC
      // id_token code path — this mock issues a plain OAuth2 access token
      // and serves the profile from /userinfo, exactly like the real
      // Google provider's non-OIDC fallback.
      authorization: { url: `${mockUrl}/authorize`, params: { scope: "email profile" } },
      token: { url: `${mockUrl}/token` },
      userinfo: { url: `${mockUrl}/userinfo` },
      allowDangerousEmailAccountLinking: true,
      profile(profile: MockGoogleProfile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    };
  }

  return GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    // FR-015: auto-link a Google sign-in to an existing email/password
    // account when the email matches, trusting Google's own verification.
    allowDangerousEmailAccountLinking: true,
  });
}

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
  providers: [buildGoogleProvider()],
  pages: {
    signIn: "/sign-in",
  },
  events: {
    // 006-user-display-names, research.md #1: this is the one hook point
    // NextAuth's own callback handler awaits, with the mapped provider
    // profile, before ever creating a session — for all three linking paths
    // (brand-new account, link while signed in, and FR-005/FR-006's
    // auto-link-by-email path). The WHERE clause makes "only when this
    // account doesn't already have one" an atomic condition of the update
    // itself (data-model.md's Atomicity section), not a separate read.
    async linkAccount({ account, profile }) {
      const name = (profile as Profile | undefined)?.name;
      if (!name) return;
      await prisma.account.updateMany({
        where: { id: account.userId, displayName: null },
        data: { displayName: name },
      });
    },
  },
  // FR-025 (2026-07-17 bug-fix amendment): unify on the exact same cookie
  // name/options the custom email/password routes and getCurrentAccount()
  // already use, so both sign-in mechanisms share one session cookie instead
  // of Auth.js silently defaulting to its own ("next-auth.session-token").
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: sessionCookieOptions,
    },
  },
};
