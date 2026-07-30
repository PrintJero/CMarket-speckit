import { notFound } from "next/navigation";
import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { MasterPageHeader } from "../../_components/MasterPageHeader";
import { MasterStatusBadge } from "../../_components/MasterStatusBadge";
import { MasterLifecycleBanner } from "../../_components/MasterLifecycleBanner";
import { MasterDetailTabs } from "../../_components/MasterDetailTabs";
import { MasterSection } from "../../_components/MasterSection";
import { MasterTable, masterThClassName } from "../../_components/MasterTable";
import { getCommunityForMaster } from "@/server/services/masterAdministrationService";
import { EditCommunityForm } from "./EditCommunityForm";
import { MembershipRow } from "./MembershipRow";
import { LifecycleActions } from "./LifecycleActions";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function CommunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const master = await requireMasterPage();
  const { communityId } = await params;
  const { tab } = await searchParams;
  const result = await getCommunityForMaster(communityId);
  if (!result.ok) notFound();

  const { community, memberships } = result;
  const activeTab = tab ?? "overview";
  const eligibleAdministrators = memberships
    .filter((m) => m.eligibleForRestoration)
    .map((m) => ({ membershipId: m.id, label: m.displayName ?? m.email }));

  return (
    <MasterShell master={master}>
      <MasterPageHeader
        title={community.name}
        status={<MasterStatusBadge status={community.status} />}
        breadcrumb={[{ label: "Communities", href: "/master/communities" }, { label: community.name }]}
      />

      {community.status === "SUSPENDED" && (
        <MasterLifecycleBanner
          tone="warning"
          title="This community is suspended"
          action={
            <LifecycleActions
              communityId={community.id}
              status={community.status}
              eligibleAdministrators={eligibleAdministrators}
            />
          }
        >
          <p>
            {community.suspensionReason && <>Reason: {community.suspensionReason}. </>}
            {community.suspendedAt && <>Suspended on {dateFormatter.format(community.suspendedAt)}. </>}
            {community.archiveScheduledAt && (
              <>Scheduled to archive on {dateFormatter.format(community.archiveScheduledAt)}. </>
            )}
            Marketplace access is restricted for every member while suspended.
          </p>
        </MasterLifecycleBanner>
      )}

      {community.status === "ARCHIVED" && (
        <MasterLifecycleBanner
          tone="neutral"
          title="This community is archived"
          action={
            <LifecycleActions
              communityId={community.id}
              status={community.status}
              eligibleAdministrators={eligibleAdministrators}
            />
          }
        >
          <p>
            Marketplace access is disabled for every member. Historical data — past listings, chats, and invitations —
            is retained but non-operational. Restore with an eligible administrator to bring it back.
          </p>
        </MasterLifecycleBanner>
      )}

      <MasterDetailTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "members", label: "Members" },
          { key: "lifecycle", label: "Lifecycle" },
        ]}
      />

      {activeTab === "overview" && (
        <div className="grid items-start gap-5 md:grid-cols-2">
          <MasterSection title="Community details">
            <dl className="divide-y divide-border px-5">
              <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                <dt className="text-ink-muted">Master ID</dt>
                <dd className="truncate font-master-mono text-ink">{community.id}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                <dt className="text-ink-muted">Status</dt>
                <dd>
                  <MasterStatusBadge status={community.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                <dt className="text-ink-muted">Created at</dt>
                <dd className="text-ink">{dateFormatter.format(community.createdAt)}</dd>
              </div>
              {community.suspendedAt && (
                <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <dt className="text-ink-muted">Suspended at</dt>
                  <dd className="text-ink">{dateFormatter.format(community.suspendedAt)}</dd>
                </div>
              )}
              {community.suspensionReason && (
                <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <dt className="text-ink-muted">Suspension reason</dt>
                  <dd className="text-ink">{community.suspensionReason}</dd>
                </div>
              )}
              {community.archiveScheduledAt && (
                <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <dt className="text-ink-muted">Archive scheduled at</dt>
                  <dd className="text-ink">{dateFormatter.format(community.archiveScheduledAt)}</dd>
                </div>
              )}
              {community.archivedAt && (
                <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <dt className="text-ink-muted">Archived at</dt>
                  <dd className="text-ink">{dateFormatter.format(community.archivedAt)}</dd>
                </div>
              )}
            </dl>
          </MasterSection>

          <MasterSection title="Edit community">
            <div className="p-5">
              <EditCommunityForm communityId={community.id} initialName={community.name} />
            </div>
          </MasterSection>
        </div>
      )}

      {activeTab === "members" && (
        <MasterTable>
          <thead>
            <tr>
              <th className={masterThClassName}>Account</th>
              <th className={masterThClassName}>Role</th>
              <th className={masterThClassName}>Epoch</th>
              <th className={masterThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <MembershipRow key={m.id} communityId={community.id} membership={m} />
            ))}
          </tbody>
        </MasterTable>
      )}

      {activeTab === "lifecycle" && (
        <MasterSection title="Lifecycle actions">
          <div className="p-5">
            <LifecycleActions
              communityId={community.id}
              status={community.status}
              eligibleAdministrators={eligibleAdministrators}
            />
          </div>
        </MasterSection>
      )}
    </MasterShell>
  );
}
