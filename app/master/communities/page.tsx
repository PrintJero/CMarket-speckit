import Link from "next/link";
import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { MasterPageHeader } from "../_components/MasterPageHeader";
import { MasterLinkButton } from "../_components/MasterButton";
import { MasterStatusBadge } from "../_components/MasterStatusBadge";
import { MasterTable, masterThClassName, masterTdClassName, masterTrClassName } from "../_components/MasterTable";
import { MasterEmptyState } from "../_components/MasterEmptyState";
import { BuildingIcon } from "../../_components/icons";
import { listCommunitiesForMaster } from "@/server/services/masterAdministrationService";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const STATUS_FILTERS: { key?: "ACTIVE" | "SUSPENDED" | "ARCHIVED"; label: string }[] = [
  { label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "ARCHIVED", label: "Archived" },
];

export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const master = await requireMasterPage();
  const { status } = await searchParams;
  const result = await listCommunitiesForMaster({
    status: status === "ACTIVE" || status === "SUSPENDED" || status === "ARCHIVED" ? status : undefined,
  });

  return (
    <MasterShell master={master}>
      <MasterPageHeader
        title="Communities"
        subtitle="Create, edit, suspend, archive, and restore — from outside, without becoming a member."
        primaryAction={<MasterLinkButton href="/master/communities/new">Create community</MasterLinkButton>}
      />

      <div className="mb-5 flex gap-5 border-b border-border" role="tablist">
        {STATUS_FILTERS.map((filter) => {
          const isActive = status === filter.key || (!status && !filter.key);
          const href = filter.key ? `/master/communities?status=${filter.key}` : "/master/communities";
          return (
            <Link
              key={filter.label}
              href={href}
              role="tab"
              aria-selected={isActive}
              className={`whitespace-nowrap border-b-2 px-0.5 py-2.5 text-[13px] font-semibold transition-colors ${
                isActive ? "border-master text-master-dark" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {result.communities.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <MasterEmptyState
            icon={BuildingIcon}
            title="No communities match this filter"
            description="Try a different status filter, or create a new community."
            action={
              <MasterLinkButton href="/master/communities/new" variant="secondary">
                Create community
              </MasterLinkButton>
            }
          />
        </div>
      ) : (
        <MasterTable>
          <thead>
            <tr>
              <th className={masterThClassName}>Name</th>
              <th className={masterThClassName}>Status</th>
              <th className={masterThClassName}>Members</th>
              <th className={masterThClassName}>Created at</th>
            </tr>
          </thead>
          <tbody>
            {result.communities.map((c) => (
              <tr key={c.id} className={masterTrClassName}>
                <td className={masterTdClassName}>
                  <Link href={`/master/communities/${c.id}`} className="font-semibold text-master hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className={masterTdClassName}>
                  <MasterStatusBadge status={c.status} />
                </td>
                <td className={masterTdClassName}>{c.memberCount}</td>
                <td className={`${masterTdClassName} whitespace-nowrap`}>{dateFormatter.format(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </MasterTable>
      )}
    </MasterShell>
  );
}
