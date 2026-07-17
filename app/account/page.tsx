import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { DisplayNameForm } from "./DisplayNameForm";
import { AppShell } from "../_components/AppShell";
import { BackLink } from "../_components/BackLink";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

export default async function AccountPage() {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  return (
    <AppShell account={account}>
      <BackLink href="/">Back home</BackLink>
      <PageHeader title="Account" />
      <Card>
        {!account.displayName && (
          <p className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Display name not set yet.
          </p>
        )}
        <DisplayNameForm currentDisplayName={account.displayName} />
      </Card>
    </AppShell>
  );
}
