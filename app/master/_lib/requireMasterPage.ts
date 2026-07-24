import { redirect } from "next/navigation";
import { requireMaster, type CurrentMasterPayload } from "@/lib/auth/currentMaster";

/**
 * Shared by every /master/* page except sign-in/change-password themselves
 * (FR-010): redirects to sign-in with no session, or to the forced
 * password-change screen while mustChangePassword is still true — a single
 * point of enforcement rather than duplicated per page.
 */
export async function requireMasterPage(): Promise<CurrentMasterPayload> {
  const master = await requireMaster();
  if (!master) {
    redirect("/master/sign-in");
  }
  if (master.mustChangePassword) {
    redirect("/master/change-password");
  }
  return master;
}
