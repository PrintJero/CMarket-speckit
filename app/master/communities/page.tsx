import Link from "next/link";
import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { PageHeader } from "../../_components/PageHeader";
import { Card } from "../../_components/Card";
import { LinkButton } from "../../_components/Button";
import { listCommunitiesForMaster } from "@/server/services/masterAdministrationService";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

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
      <PageHeader
        title="Communities"
        subtitle="Create, edit, suspend, archive, and restore — from outside, without becoming a member."
        actions={<LinkButton href="/master/communities/new">Create community</LinkButton>}
      />
      <div className="mb-4 flex gap-2 text-[13px] font-semibold">
        <Link href="/master/communities" className={!status ? "text-brand" : "text-ink-muted"}>
          All
        </Link>
        <Link href="/master/communities?status=ACTIVE" className={status === "ACTIVE" ? "text-brand" : "text-ink-muted"}>
          Active
        </Link>
        <Link href="/master/communities?status=SUSPENDED" className={status === "SUSPENDED" ? "text-brand" : "text-ink-muted"}>
          Suspended
        </Link>
        <Link href="/master/communities?status=ARCHIVED" className={status === "ARCHIVED" ? "text-brand" : "text-ink-muted"}>
          Archived
        </Link>
      </div>
      <Card className="min-w-0">
        {result.communities.length === 0 ? (
          <p className="py-10 text-center text-ink-muted">No communities match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Name
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Status
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Members
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Created at
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.communities.map((c) => (
                  <tr key={c.id}>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      <Link href={`/master/communities/${c.id}`} className="font-semibold text-brand">
                        {c.name}
                      </Link>
                    </td>
                    <td className="border-b border-border px-4 py-3 last:border-none">{c.status}</td>
                    <td className="border-b border-border px-4 py-3 last:border-none">{c.memberCount}</td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                      {dateFormatter.format(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </MasterShell>
  );
}
