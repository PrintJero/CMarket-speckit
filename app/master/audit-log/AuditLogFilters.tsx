"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MasterFormField, masterFieldInputClassName } from "../_components/MasterFormField";
import { MasterButton, MasterLinkButton } from "../_components/MasterButton";

export function AuditLogFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [action, setAction] = useState(searchParams.get("action") ?? "");
  const [targetType, setTargetType] = useState(searchParams.get("targetType") ?? "");
  const [targetId, setTargetId] = useState(searchParams.get("targetId") ?? "");

  // Reflects the currently-APPLIED filters (the URL), not unsaved edits in
  // the inputs above — "Clear filters" only needs to appear once there's an
  // actual filter narrowing the table beneath it.
  const hasActiveFilter = Boolean(
    searchParams.get("action") || searchParams.get("targetType") || searchParams.get("targetId"),
  );

  function apply() {
    // Deliberately never carries forward an existing `cursor` param — a new
    // filter always restarts pagination from the first page.
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (targetId) params.set("targetId", targetId);
    router.push(`/master/audit-log?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="w-40">
        <MasterFormField label="Action">
          <input
            className={masterFieldInputClassName}
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </MasterFormField>
      </div>
      <div className="w-40">
        <MasterFormField label="Target type">
          <input
            className={masterFieldInputClassName}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          />
        </MasterFormField>
      </div>
      <div className="w-56">
        <MasterFormField label="Target ID">
          <input
            className={masterFieldInputClassName}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          />
        </MasterFormField>
      </div>
      <MasterButton variant="secondary" onClick={apply}>
        Filter
      </MasterButton>
      {hasActiveFilter && (
        <MasterLinkButton href="/master/audit-log" variant="ghost">
          Clear filters
        </MasterLinkButton>
      )}
    </div>
  );
}
