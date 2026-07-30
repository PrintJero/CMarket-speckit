import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { MasterPageHeader } from "../../_components/MasterPageHeader";
import { MasterStatusBadge } from "../../_components/MasterStatusBadge";
import { MasterSection } from "../../_components/MasterSection";
import { MasterDetailTabs, type MasterTab } from "../../_components/MasterDetailTabs";
import { MasterEmptyState } from "../../_components/MasterEmptyState";
import { BuildingIcon } from "../../../_components/icons";
import { getAccountForMaster } from "@/server/services/masterAdministrationService";
import { EditAccountForm } from "./EditAccountForm";
import { AccountActions } from "./AccountActions";

const TABS: MasterTab[] = [
  { key: "profile", label: "Profile" },
  { key: "communities", label: "Communities administered" },
];

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const master = await requireMasterPage();
  const { accountId } = await params;
  const { tab } = await searchParams;
  const result = await getAccountForMaster(accountId);
  if (!result.ok) notFound();

  const { account, administeredCommunities } = result;
  const deleted = Boolean(account.deletedAt);
  const title = account.displayName ?? account.email;
  const activeTab = tab === "communities" ? "communities" : "profile";

  return (
    <MasterShell master={master}>
      <MasterPageHeader
        title={title}
        subtitle={account.displayName ? account.email : undefined}
        status={<MasterStatusBadge status={deleted ? "DELETED" : account.status} />}
        breadcrumb={[{ label: "Accounts", href: "/master/accounts" }, { label: title }]}
      />

      <MasterSection title="Actions" description="Suspend, reactivate, reset password, or permanently delete this account." className="mb-6">
        <div className="p-5">
          <AccountActions accountId={account.id} status={account.status} deleted={deleted} />
        </div>
      </MasterSection>

      <MasterDetailTabs tabs={TABS} />

      {activeTab === "profile" ? (
        <MasterSection title="Profile">
          <div className="p-5">
            {deleted ? (
              <p className="text-[13px] text-ink-muted">
                This account has been permanently deleted. Profile details can no longer be edited.
              </p>
            ) : (
              <EditAccountForm
                accountId={account.id}
                initialEmail={account.email}
                initialDisplayName={account.displayName}
              />
            )}
          </div>
        </MasterSection>
      ) : (
        <MasterSection title="Communities administered">
          {administeredCommunities.length === 0 ? (
            <MasterEmptyState
              icon={BuildingIcon}
              title="Not an administrator of any community"
              description="This account does not currently administer any community."
            />
          ) : (
            <ul className="flex flex-col gap-1.5 p-5 text-sm">
              {administeredCommunities.map((c) => (
                <li key={c.communityId}>
                  <Link
                    href={`/master/communities/${c.communityId}`}
                    className="font-semibold text-master hover:underline"
                  >
                    {c.communityName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </MasterSection>
      )}
    </MasterShell>
  );
}
