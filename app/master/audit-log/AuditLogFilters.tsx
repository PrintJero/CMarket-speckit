"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FormField, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

export function AuditLogFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [action, setAction] = useState(searchParams.get("action") ?? "");
  const [targetType, setTargetType] = useState(searchParams.get("targetType") ?? "");
  const [targetId, setTargetId] = useState(searchParams.get("targetId") ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (targetId) params.set("targetId", targetId);
    router.push(`/master/audit-log?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="w-40">
        <FormField label="Action">
          <input className={fieldInputClassName} value={action} onChange={(e) => setAction(e.target.value)} />
        </FormField>
      </div>
      <div className="w-40">
        <FormField label="Target type">
          <input className={fieldInputClassName} value={targetType} onChange={(e) => setTargetType(e.target.value)} />
        </FormField>
      </div>
      <div className="w-56">
        <FormField label="Target ID">
          <input className={fieldInputClassName} value={targetId} onChange={(e) => setTargetId(e.target.value)} />
        </FormField>
      </div>
      <Button variant="secondary" onClick={apply}>
        Filter
      </Button>
    </div>
  );
}
