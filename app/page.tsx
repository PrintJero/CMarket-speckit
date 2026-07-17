import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { SignOutButton } from "./_components/SignOutButton";

export default async function HomePage() {
  const account = await getCurrentAccount();

  if (!account) {
    return (
      <main className="auth-shell">
        <div className="auth-shell__blob auth-shell__blob--one" aria-hidden="true" />
        <div className="auth-shell__blob auth-shell__blob--two" aria-hidden="true" />
        <div className="auth-shell__wordmark">CMarket</div>
        <div className="card" style={{ textAlign: "center" }}>
          <h1>Welcome</h1>
          <p>Create an account or sign in to get started.</p>
          <Link className="btn-primary" href="/sign-up" style={{ display: "block" }}>
            Sign up
          </Link>
          <Link
            className="btn-secondary"
            href="/sign-in"
            style={{ display: "block", textAlign: "center" }}
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const avatarInitial = account.email.charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar__wordmark">CMarket</div>
        <div className="app-sidebar__user">
          <span className="avatar" title={account.email}>
            {avatarInitial}
          </span>
          <span className="app-sidebar__user-email">{account.email}</span>
        </div>
        {account.memberships.length > 0 && (
          <nav className="app-sidebar__communities">
            <span className="micro-label">Your communities</span>
            <ul>
              {account.memberships.map((membership) => (
                <li key={membership.communityId}>
                  {membership.role === "ADMINISTRATOR" ? (
                    <Link href={`/communities/${membership.communityId}/admin`}>
                      {membership.communityName}
                    </Link>
                  ) : (
                    <span>{membership.communityName}</span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="app-sidebar__account">
          <span className="micro-label">Signed in as {account.email}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className="app-main">
        {account.memberships.length === 0 ? (
          <div className="empty-state">
            <h1>You&apos;re all set</h1>
            <p>
              You don&apos;t belong to any community yet. Once a community administrator invites
              you, it will appear here.
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <h1>Welcome back</h1>
            <p>Pick a community from the sidebar to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
