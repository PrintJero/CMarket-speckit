import { cookies } from "next/headers";
import { getValidSession } from "@/server/services/sessionService";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

export interface CurrentAccountPayload {
  accountId: string;
  email: string;
  verified: boolean;
  /** FR-003/FR-013: this feature never resolves any community membership. */
  memberships: [];
}

interface SessionAccount {
  accountId: string;
  email: string;
  emailVerifiedAt: Date | null;
}

/**
 * The only shape a signed-in account's identity is ever exposed as. It
 * carries nothing beyond an always-empty memberships list, regardless of
 * which signup method created the account — this feature has no code path
 * that can populate it (FR-003, FR-013).
 */
export function toCurrentAccountPayload(session: SessionAccount): CurrentAccountPayload {
  return {
    accountId: session.accountId,
    email: session.email,
    verified: Boolean(session.emailVerifiedAt),
    memberships: [],
  };
}

export async function getCurrentAccount(): Promise<CurrentAccountPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await getValidSession(token);
  if (!session) return null;

  return toCurrentAccountPayload(session);
}
