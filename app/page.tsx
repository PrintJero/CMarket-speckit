import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { AuthShell } from "./_components/AuthShell";
import { AppShell } from "./_components/AppShell";
import { LinkButton } from "./_components/Button";

export default async function HomePage() {
  const account = await getCurrentAccount();

  if (!account) {
    return (
      <AuthShell>
        <h1 className="mb-2 text-center text-[1rem] font-bold leading-tight text-ink">
          Buy and sell within your community
        </h1>
        <p className="mb-6 text-center text-[13px] leading-relaxed text-ink-muted">
          A private marketplace for people you already trust — no public listings, no strangers.
        </p>
        <LinkButton href="/sign-up" fullWidth>
          Sign up
        </LinkButton>
        <LinkButton href="/sign-in" variant="secondary" fullWidth className="mt-3">
          Sign in
        </LinkButton>
        <p className="mt-5 text-center text-[13px] text-ink-muted">
          Access is by invitation — ask your community&apos;s admin to add you.
        </p>
      </AuthShell>
    );
  }

  return (
    <AppShell account={account}>
      <div className="mx-auto max-w-md text-center">
        {account.memberships.length === 0 ? (
          <>
            <h1 className="text-[1.375rem] font-bold text-ink">You&apos;re all set</h1>
            <p>
              You don&apos;t belong to any community yet. Once a community administrator invites
              you, it will appear here.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[1.375rem] font-bold text-ink">Welcome back</h1>
            <p>Pick a community from the sidebar to get started.</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
