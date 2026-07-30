import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
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
        <p className="py-6 text-center text-[14px] font-semibold text-ink-muted">
          Account settings coming soon
        </p>
      </Card>
    </AppShell>
  );
}
