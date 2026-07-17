import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { AuthShell } from "./_components/AuthShell";
import { AppShell } from "./_components/AppShell";
import { LinkButton } from "./_components/Button";

export default async function HomePage() {
  const account = await getCurrentAccount();

  if (!account) {
    return (
      <AuthShell>
        <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Welcome</h1>
        <p className="text-center">Create an account or sign in to get started.</p>
        <LinkButton href="/sign-up" fullWidth>
          Sign up
        </LinkButton>
        <LinkButton href="/sign-in" variant="secondary" fullWidth className="mt-3">
          Sign in
        </LinkButton>
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
