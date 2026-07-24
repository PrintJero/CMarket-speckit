import { notFound } from "next/navigation";
import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";
import { getCommunityForMaster } from "@/server/services/masterAdministrationService";
import { EditCommunityForm } from "./EditCommunityForm";
import { MembershipRow } from "./MembershipRow";
import { LifecycleActions } from "./LifecycleActions";

export default async function CommunityDetailPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const master = await requireMasterPage();
  const { communityId } = await params;
  const result = await getCommunityForMaster(communityId);
  if (!result.ok) notFound();

  const { community, memberships } = result;

  return (
    <MasterShell master={master}>
      <PageHeader title={community.name} subtitle={`Status: ${community.status}`} />
      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Lifecycle</h2>
          {community.suspensionReason && (
            <p className="mb-3 text-[13px] text-ink-muted">Reason: {community.suspensionReason}</p>
          )}
          <LifecycleActions
            communityId={community.id}
            status={community.status}
            eligibleAdministrators={memberships
              .filter((m) => m.eligibleForRestoration)
              .map((m) => ({ membershipId: m.id, label: m.displayName ?? m.email }))}
          />
          <hr className="my-4 border-border" />
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Edit</h2>
          <EditCommunityForm communityId={community.id} initialName={community.name} />
        </Card>
        <Card className="min-w-0">
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Members</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Account
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Role
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Epoch
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <MembershipRow key={m.id} communityId={community.id} membership={m} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </MasterShell>
  );
}
