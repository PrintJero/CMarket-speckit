import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/validation/email";
import {
  createSession,
  deleteSession,
  extendSession,
  findSessionWithAccount,
} from "@/server/services/sessionService";
import type { Account } from "@prisma/client";

function toAdapterUser(account: Account): AdapterUser {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerifiedAt,
  };
}

/**
 * Custom Auth.js adapter over our own Account/AuthIdentity/Session schema
 * (data-model.md) — not the generic @auth/prisma-adapter User/Account/Session
 * shape, since our "Account" already means something different (the whole
 * CMarket identity) than Auth.js's "Account" (a single linked provider).
 *
 * Only Google flows through this adapter. Email/password sign-in is handled
 * by our own routes (US2) so that both auth methods share one Session table
 * and one revocation path (see research.md #2 and sessionService.ts).
 */
export function buildPrismaAuthAdapter(): Adapter {
  return {
    async createUser(user: Omit<AdapterUser, "id">) {
      // Reached only for a brand-new Google sign-up (FR-002) — Google's own
      // verification is inherited immediately (FR-006), regardless of what
      // Auth.js core passed in `user.emailVerified`.
      const created = await prisma.account.create({
        data: {
          email: normalizeEmail(user.email),
          emailVerifiedAt: new Date(),
          // 006-user-display-names FR-004: populated from the provider's own
          // profile name at the moment of creation, with no prompt.
          displayName: (user as { name?: string | null }).name ?? null,
        },
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      const account = await prisma.account.findUnique({ where: { id } });
      return account ? toAdapterUser(account) : null;
    },

    async getUserByEmail(email) {
      // FR-017: case-insensitive exact match.
      const account = await prisma.account.findUnique({
        where: { email: normalizeEmail(email) },
      });
      return account ? toAdapterUser(account) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const identity = await prisma.authIdentity.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { account: true },
      });
      return identity ? toAdapterUser(identity.account) : null;
    },

    async updateUser(user) {
      const data: { email?: string; emailVerifiedAt?: Date | null } = {};
      if (user.email !== undefined) data.email = normalizeEmail(user.email);
      if (user.emailVerified !== undefined) data.emailVerifiedAt = user.emailVerified;
      const updated = await prisma.account.update({ where: { id: user.id }, data });
      return toAdapterUser(updated);
    },

    async linkAccount(account: AdapterAccount) {
      // FR-015/FR-018: Google auto-linked to an existing password account.
      // `verifiedNow.count` is the atomic check-and-act signal for "this
      // account was unverified and this call is what verified it" — not a
      // separate read-then-branch, which would leave a race window (see
      // research.md #8).
      const [, verifiedNow] = await prisma.$transaction([
        prisma.authIdentity.create({
          data: {
            accountId: account.userId,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        }),
        prisma.account.updateMany({
          where: { id: account.userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date(), passwordHash: null },
        }),
      ]);

      if (verifiedNow.count > 0) {
        // FR-018: a password credential set up before any proof of email
        // ownership is untrusted the moment ownership is proven via Google —
        // discard it (above), revoke every session it could have created,
        // and invalidate any verification token still pending.
        await prisma.session.deleteMany({ where: { accountId: account.userId } });
        await prisma.verificationToken.updateMany({
          where: { accountId: account.userId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
      }
    },

    async createSession({ sessionToken, userId, expires }) {
      const session = await createSession(userId, sessionToken, expires);
      return { sessionToken: session.sessionToken, userId, expires: session.expiresAt };
    },

    async getSessionAndUser(sessionToken) {
      const found = await findSessionWithAccount(sessionToken);
      if (!found) return null;
      return {
        session: {
          sessionToken: found.sessionToken,
          userId: found.accountId,
          expires: found.expiresAt,
        },
        user: toAdapterUser(found.account),
      };
    },

    async updateSession({ sessionToken, expires }) {
      if (!expires) return null;
      await extendSession(sessionToken, expires);
      const found = await findSessionWithAccount(sessionToken);
      if (!found) return null;
      return { sessionToken: found.sessionToken, userId: found.accountId, expires: found.expiresAt };
    },

    async deleteSession(sessionToken) {
      await deleteSession(sessionToken);
    },
  };
}
