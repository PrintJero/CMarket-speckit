import { cookies } from "next/headers";
import { getValidMasterSession } from "@/server/services/masterSessionService";
import { MASTER_SESSION_COOKIE_NAME } from "@/lib/auth/masterSessionCookie";

export interface CurrentMasterPayload {
  masterId: string;
  masterIdValue: string;
  email: string;
  mustChangePassword: boolean;
}

/**
 * Mirrors currentAccount.ts's getCurrentAccount() exactly, but reads the
 * fully separate cmarket_master_session cookie and MasterSession store
 * (research.md #1) — never interchangeable with an ordinary Account session.
 * Used by every /master and /api/master page/route (FR-018) — never
 * satisfied by a fabricated community Membership.
 */
export async function requireMaster(): Promise<CurrentMasterPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MASTER_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return getValidMasterSession(token);
}
