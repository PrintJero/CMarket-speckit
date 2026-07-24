import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";
import { getAccountForMaster } from "@/server/services/masterAdministrationService";
import { EditAccountForm } from "./EditAccountForm";
import { AccountActions } from "./AccountActions";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const master = await requireMasterPage();
  const { accountId } = await params;
  const result = await getAccountForMaster(accountId);
  if (!result.ok) notFound();

  const { account, administeredCommunities } = result;

  return (
    <MasterShell master={master}>
      <PageHeader title={account.displayName ?? account.email} subtitle={`Status: ${account.deletedAt ? "DELETED" : account.status}`} />
      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Edit</h2>
          {!account.deletedAt && (
            <EditAccountForm accountId={account.id} initialEmail={account.email} initialDisplayName={account.displayName} />
          )}
          <hr className="my-4 border-border" />
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Actions</h2>
          <AccountActions accountId={account.id} status={account.status} deleted={Boolean(account.deletedAt)} />
        </Card>
        <Card className="min-w-0">
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Communities administered
          </h2>
          {administeredCommunities.length === 0 ? (
            <p className="text-sm text-ink-muted">Not currently an administrator of any community.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {administeredCommunities.map((c) => (
                <li key={c.communityId}>
                  <Link href={`/master/communities/${c.communityId}`} className="font-semibold text-brand">
                    {c.communityName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </MasterShell>
  );
}
