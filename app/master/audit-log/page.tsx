import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { PageHeader } from "../../_components/PageHeader";
import { Card } from "../../_components/Card";
import { listAuditEntries } from "@/server/services/auditService";
import { AuditLogFilters } from "./AuditLogFilters";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; targetType?: string; targetId?: string; cursor?: string }>;
}) {
  const master = await requireMasterPage();
  const { action, targetType, targetId, cursor } = await searchParams;

  const result = await listAuditEntries({ action, targetType, targetId, cursor });

  return (
    <MasterShell master={master}>
      <PageHeader title="Audit log" subtitle="Every platform-administration action, including rejections." />
      <AuditLogFilters />
      <Card className="min-w-0">
        {result.entries.length === 0 ? (
          <p className="py-10 text-center text-ink-muted">No entries match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[800px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    When
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Actor
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Action
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Target
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                      {dateFormatter.format(entry.createdAt)}
                    </td>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      {entry.actorType === "SYSTEM" ? "System" : entry.actorMasterId}
                    </td>
                    <td className="border-b border-border px-4 py-3 font-mono text-[13px] last:border-none">
                      {entry.action}
                    </td>
                    <td className="overflow-hidden text-ellipsis border-b border-border px-4 py-3 last:border-none">
                      {entry.targetType}
                      {entry.targetId ? `:${entry.targetId}` : ""}
                    </td>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      <span className={entry.outcome === "SUCCESS" ? "text-ink" : "text-danger"}>
                        {entry.outcome}
                      </span>
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
