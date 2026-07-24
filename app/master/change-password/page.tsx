import { redirect } from "next/navigation";
import { requireMaster } from "@/lib/auth/currentMaster";
import { AuthShell } from "../../_components/AuthShell";
import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * Reachable while mustChangePassword is true (unlike every other /master
 * page — requireMasterPage() would redirect back here, looping). Still
 * requires SOME authenticated MasterSession, so an anonymous visitor is
 * redirected to sign-in rather than shown the form at all.
 */
export default async function MasterChangePasswordPage() {
  const master = await requireMaster();
  if (!master) {
    redirect("/master/sign-in");
  }

  return (
    <AuthShell>
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Choose a new password</h1>
      <p className="mb-5 text-center text-[13px] text-ink-muted">
        Required before any other administrative action.
      </p>
      <ChangePasswordForm />
    </AuthShell>
  );
}
