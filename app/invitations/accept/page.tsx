import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getInvitationMetadata } from "@/server/services/invitationService";
import { AcceptButton } from "./AcceptButton";

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
      <main className="auth-shell">
        <div className="card">
          <h1>Invitation link invalid</h1>
          <p>This link is missing its invitation token.</p>
        </div>
      </main>
    );
  }

  const metadata = await getInvitationMetadata(token);

  if (!metadata.ok) {
    return (
      <main className="auth-shell">
        <div className="card">
          <h1>Invitation no longer valid</h1>
          <p>This invitation has already been used, superseded, or does not exist.</p>
        </div>
      </main>
    );
  }

  const account = await getCurrentAccount();

  return (
    <main className="auth-shell">
      <div className="card">
        <h1>Accept invitation to {metadata.communityName}</h1>
        {account ? (
          <AcceptButton token={token} />
        ) : (
          <>
            <p>
              This invitation was sent to <strong>{metadata.email}</strong>. Sign in or sign up with
              that exact email, then return to this same link to accept.
            </p>
            <Link className="btn-primary" href="/sign-in" style={{ display: "block", textAlign: "center" }}>
              Sign in
            </Link>
            <Link
              className="btn-secondary"
              href="/sign-up"
              style={{ display: "block", textAlign: "center" }}
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
