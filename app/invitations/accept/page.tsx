import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getInvitationMetadata } from "@/server/services/invitationService";
import { AcceptButton } from "./AcceptButton";
import { AuthShell } from "../../_components/AuthShell";
import { LinkButton } from "../../_components/Button";

/**
 * research.md #9: no automatic redirect chaining for a signed-out visitor —
 * they're told which email to use and left to navigate to sign-in/up themselves.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthShell>
        <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Invitation link invalid</h1>
        <p className="text-center">This link is missing its invitation token.</p>
      </AuthShell>
    );
  }

  const metadata = await getInvitationMetadata(token);

  if (!metadata.ok) {
    return (
      <AuthShell>
        <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Invitation no longer valid</h1>
        <p className="text-center">This invitation has already been used, superseded, or does not exist.</p>
      </AuthShell>
    );
  }

  const account = await getCurrentAccount();

  return (
    <AuthShell>
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">
        Accept invitation to {metadata.communityName}
      </h1>
      {account ? (
        <AcceptButton token={token} />
      ) : (
        <>
          <p className="text-center">
            This invitation was sent to <strong>{metadata.email}</strong>. Sign in or sign up with
            that exact email, then return to this same link to accept.
          </p>
          <LinkButton href="/sign-in" fullWidth>
            Sign in
          </LinkButton>
          <LinkButton href="/sign-up" variant="secondary" fullWidth className="mt-3">
            Sign up
          </LinkButton>
        </>
      )}
    </AuthShell>
  );
}
