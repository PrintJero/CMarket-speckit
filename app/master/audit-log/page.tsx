import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { MasterPageHeader } from "../_components/MasterPageHeader";
import { MasterSection } from "../_components/MasterSection";
import { MasterTable, masterThClassName, masterTdClassName, masterTrClassName } from "../_components/MasterTable";
import { MasterStatusBadge } from "../_components/MasterStatusBadge";
import { MasterEmptyState } from "../_components/MasterEmptyState";
import { MasterPagination } from "../_components/MasterPagination";
import { ClockIcon } from "../../_components/icons";
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
  const hasMore = Boolean(result.nextCursor);

  // Preserve the active filters when advancing to the next page — only the
  // cursor changes; a fresh filter (via AuditLogFilters) always drops it.
  const nextParams = new URLSearchParams();
  if (action) nextParams.set("action", action);
  if (targetType) nextParams.set("targetType", targetType);
  if (targetId) nextParams.set("targetId", targetId);
  if (result.nextCursor) nextParams.set("cursor", result.nextCursor);

  return (
    <MasterShell master={master}>
      <MasterPageHeader title="Audit log" subtitle="Every platform-administration action, including rejections." />
      <AuditLogFilters />
      {result.entries.length === 0 ? (
        <MasterSection className="min-w-0">
          <MasterEmptyState
            icon={ClockIcon}
            title="No entries match this filter"
            description="Adjust or clear the action, target type, and target ID filters above."
          />
        </MasterSection>
      ) : (
        <div className="min-w-0">
          <MasterTable>
            <thead>
              <tr>
                <th className={masterThClassName}>When</th>
                <th className={masterThClassName}>Actor</th>
                <th className={masterThClassName}>Action</th>
                <th className={masterThClassName}>Target</th>
                <th className={masterThClassName}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.id} className={masterTrClassName}>
                  <td className={`${masterTdClassName} whitespace-nowrap`}>{dateFormatter.format(entry.createdAt)}</td>
                  <td className={masterTdClassName}>
                    {entry.actorType === "SYSTEM" ? (
                      <MasterStatusBadge status="SYSTEM" />
                    ) : (
                      <span className="font-master-mono">{entry.actorMasterId}</span>
                    )}
                  </td>
                  <td className={`${masterTdClassName} font-master-mono`}>{entry.action}</td>
                  <td className={`${masterTdClassName} font-master-mono`}>
                    {entry.targetType}
                    {entry.targetId ? `:${entry.targetId}` : ""}
                  </td>
                  <td className={masterTdClassName}>
                    <MasterStatusBadge status={entry.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </MasterTable>
          {hasMore && (
            <div className="mt-3">
              <MasterPagination hasMore={hasMore} nextHref={`/master/audit-log?${nextParams.toString()}`} />
            </div>
          )}
        </div>
      )}
    </MasterShell>
  );
}
