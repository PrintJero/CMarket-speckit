import Link from "next/link";
import { requireMasterPage } from "./_lib/requireMasterPage";
import { MasterShell } from "./_components/MasterShell";
import { MasterPageHeader } from "./_components/MasterPageHeader";
import { MasterSection } from "./_components/MasterSection";
import { MasterEmptyState } from "./_components/MasterEmptyState";
import {
  listCommunitiesForMaster,
  listAccountsForMaster,
  getCommunityForMaster,
} from "@/server/services/masterAdministrationService";
import { listAuditEntries } from "@/server/services/auditService";
import { prisma } from "@/lib/prisma";
import { BuildingIcon, UsersIcon, ShieldIcon, ArchiveIcon, ClockIcon, ListIcon } from "../_components/icons";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * FR-021: navigation + operational state only — no transaction analytics,
 * sales rankings, or revenue charts (explicitly excluded per spec.md).
 * Every count/list here is a direct read of already-implemented service
 * functions (the same ones the Communities/Accounts/Masters/Audit-log
 * pages use) — nothing invented, nothing hardcoded.
 */
export default async function MasterDashboardPage() {
  const master = await requireMasterPage();

  const [{ communities }, { accounts }, activeMasterCount, { entries: recentAuditEntries }] = await Promise.all([
    listCommunitiesForMaster({}),
    listAccountsForMaster({}),
    prisma.masterIdentity.count({ where: { status: "ACTIVE" } }),
    listAuditEntries({ pageSize: 6 }),
  ]);

  const activeCommunities = communities.filter((c) => c.status === "ACTIVE").length;
  const suspendedCommunities = communities.filter((c) => c.status === "SUSPENDED");
  const archivedCommunities = communities.filter((c) => c.status === "ARCHIVED").length;
  const activeAccounts = accounts.filter((a) => a.status === "ACTIVE" && !a.deletedAt).length;
  const suspendedAccounts = accounts.filter((a) => a.status === "SUSPENDED" && !a.deletedAt).length;

  // The list endpoint doesn't carry lifecycle dates (only the detail one
  // does) — fetch details for just the suspended subset to rank by
  // soonest scheduled archival.
  const suspendedDetails = await Promise.all(suspendedCommunities.map((c) => getCommunityForMaster(c.id)));
  const approachingArchival = suspendedDetails
    .filter((r) => r.ok)
    .map((r) => (r as Extract<typeof r, { ok: true }>).community)
    .filter((c) => c.archiveScheduledAt)
    .sort((a, b) => new Date(a.archiveScheduledAt!).getTime() - new Date(b.archiveScheduledAt!).getTime())
    .slice(0, 5);

  const stats = [
    { label: "Active communities", value: activeCommunities, href: "/master/communities?status=ACTIVE", icon: BuildingIcon },
    {
      label: "Suspended communities",
      value: suspendedCommunities.length,
      href: "/master/communities?status=SUSPENDED",
      icon: BuildingIcon,
    },
    { label: "Archived communities", value: archivedCommunities, href: "/master/communities?status=ARCHIVED", icon: ArchiveIcon },
    { label: "Active accounts", value: activeAccounts, href: "/master/accounts", icon: UsersIcon },
    { label: "Suspended accounts", value: suspendedAccounts, href: "/master/accounts", icon: UsersIcon },
    { label: "Active MASTER operators", value: activeMasterCount, href: "/master/masters", icon: ShieldIcon },
  ];

  return (
    <MasterShell master={master}>
      <MasterPageHeader
        title="Overview"
        subtitle={`Signed in as ${master.masterIdValue}. Platform administration — separate from the marketplace.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-master/40 hover:bg-master-tint/40"
            >
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-master-tint text-master">
                <Icon className="h-4 w-4" />
              </span>
              <div className="text-[1.5rem] font-bold leading-none text-ink">{stat.value}</div>
              <div className="mt-1.5 text-[12.5px] text-ink-muted">{stat.label}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MasterSection title="Approaching archival" description="Suspended communities, soonest first">
          {approachingArchival.length === 0 ? (
            <MasterEmptyState
              icon={ClockIcon}
              title="Nothing approaching archival"
              description="No suspended community is currently scheduled to archive."
            />
          ) : (
            <ul>
              {approachingArchival.map((community) => (
                <li key={community.id} className="border-b border-border last:border-none">
                  <Link
                    href={`/master/communities/${community.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-bg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ink">{community.name}</p>
                      <p className="text-[12px] text-ink-muted">
                        Suspended {community.suspendedAt ? DATE_FORMAT.format(new Date(community.suspendedAt)) : "—"}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      <p className="text-[12.5px] font-semibold text-warning-dark">
                        Archives{" "}
                        {community.archiveScheduledAt ? DATE_FORMAT.format(new Date(community.archiveScheduledAt)) : "—"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </MasterSection>

        <MasterSection
          title="Recent activity"
          description="Latest administrative actions"
          actions={
            <Link href="/master/audit-log" className="text-[12.5px] font-semibold text-master hover:underline">
              View audit log →
            </Link>
          }
        >
          {recentAuditEntries.length > 0 ? (
            <ul>
              {recentAuditEntries.map((entry) => (
                <li key={entry.id} className="border-b border-border px-5 py-3 last:border-none">
                  <p className="text-[13px] font-semibold text-ink">{entry.action}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {entry.actorType === "SYSTEM" ? "System" : entry.actorMasterId} ·{" "}
                    {DATE_FORMAT.format(new Date(entry.createdAt))}
                    {entry.outcome === "FAILURE" && <span className="ml-1.5 font-semibold text-danger">Failed</span>}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <MasterEmptyState icon={ListIcon} title="No activity yet" description="Administrative actions will appear here as they happen." />
          )}
        </MasterSection>
      </div>
    </MasterShell>
  );
}
