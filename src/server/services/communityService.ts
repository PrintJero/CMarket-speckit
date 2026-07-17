import { prisma } from "@/lib/prisma";
import { isValidCommunityName } from "@/lib/validation/communityName";
import { assertEmailVerified } from "@/server/services/accountService";

export type CreateCommunityResult =
  | { ok: true; community: { id: string; name: string; createdAt: Date } }
  | { ok: false; reason: "invalid_name" }
  | { ok: false; reason: "account_not_found" }
  | { ok: false; reason: "account_not_verified" };

export interface CreateCommunityInput {
  name: string;
  founderEmail: string;
  invokedBy: string;
}

/**
 * FR-001–FR-014: the sole bootstrap path for a community's first (and
 * initially only) administrator. Complete and safe from its first version —
 * the account-existence and account-verified checks are not deferrable
 * (Principle I): no version of this function may create a community for a
 * nonexistent or unverified account. Never reachable from app/ (FR-002) —
 * enforced by tests/unit/test_community_creation_not_networked.ts.
 */
export async function createCommunity(input: CreateCommunityInput): Promise<CreateCommunityResult> {
  if (!isValidCommunityName(input.name)) {
    return { ok: false, reason: "invalid_name" };
  }

  const account = await prisma.account.findUnique({ where: { email: input.founderEmail } });
  if (!account) {
    return { ok: false, reason: "account_not_found" };
  }

  if (!(await assertEmailVerified(account.id))) {
    return { ok: false, reason: "account_not_verified" };
  }

  const community = await prisma.$transaction(async (tx) => {
    const created = await tx.community.create({
      data: { name: input.name, createdByOperator: input.invokedBy },
    });
    await tx.membership.create({
      data: { accountId: account.id, communityId: created.id, role: "ADMINISTRATOR" },
    });
    return created;
  });

  return {
    ok: true,
    community: { id: community.id, name: community.name, createdAt: community.createdAt },
  };
}
