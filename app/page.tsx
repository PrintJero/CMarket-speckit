import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { AuthShell } from "./_components/AuthShell";
import { AppShell } from "./_components/AppShell";
import { LinkButton } from "./_components/Button";
import { CommunitySelector } from "./_components/CommunitySelector";

/**
 * 015-navigation-shell-community-selector, contracts/navigation-shell-api.md
 * `GET /`. The top-level entry-point router: unauthenticated members see the
 * unchanged marketing/sign-in landing; a zero-membership account sees the
 * unchanged empty state (Principle I — no directory/browse/join affordance,
 * FR-004); a member with a live remembered active community (FR-001a) is
 * taken straight into it; otherwise the community-selection screen (FR-001).
 */
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

  if (account.memberships.length === 0) {
    return (
      <AppShell account={account}>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-[1.375rem] font-bold text-ink">You&apos;re all set</h1>
          <p>
            You don&apos;t belong to any community yet. Once a community administrator invites
            you, it will appear here.
          </p>
        </div>
      </AppShell>
    );
  }

  if (account.activeCommunityId) {
    redirect(`/communities/${account.activeCommunityId}`);
  }

  return (
    <AppShell account={account}>
      <CommunitySelector memberships={account.memberships} />
    </AppShell>
  );
}
