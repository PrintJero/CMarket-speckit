"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../_components/Button";

interface EligibleMember {
  membershipId: string;
  label: string;
}

export function AccountActions({
  accountId,
  status,
  deleted,
}: {
  accountId: string;
  status: "ACTIVE" | "SUSPENDED";
  deleted: boolean;
}) {
  const router = useRouter();
  const [affected, setAffected] = useState<{ communityId: string; communityName: string }[] | null>(null);
  const [eligibleByCommunity, setEligibleByCommunity] = useState<Record<string, EligibleMember[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<"suspend" | "delete" | null>(null);

  async function attempt(action: "suspend" | "delete", assignments?: { communityId: string; membershipId: string }[]) {
    const response = await fetch(`/api/master/accounts/${accountId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replacementAdministratorAssignments: assignments }),
    });
    const data = await response.json();

    if (data.ok) {
      setAffected(null);
      router.refresh();
      return;
    }

    if (data.reason === "would_orphan_communities") {
      setPendingAction(action);
      const communities = await Promise.all(
        (data.affectedCommunityIds as string[]).map(async (id: string) => {
          const detailResponse = await fetch(`/api/master/communities/${id}`);
          const detail = await detailResponse.json();
          setEligibleByCommunity((prev) => ({
            ...prev,
            [id]: detail.ok
              ? detail.memberships
                  .filter((m: { accountId: string; isCurrent: boolean }) => m.accountId !== accountId && m.isCurrent)
                  .map((m: { id: string; displayName: string | null; email: string }) => ({
                    membershipId: m.id,
                    label: m.displayName ?? m.email,
                  }))
              : [],
          }));
          return { communityId: id, communityName: detail.ok ? detail.community.name : id };
        }),
      );
      setAffected(communities);
      return;
    }

    window.alert(`Failed: ${data.reason}`);
  }

  async function confirmWithAssignments() {
    if (!pendingAction || !affected) return;
    const assignments = affected.map((c) => ({ communityId: c.communityId, membershipId: chosen[c.communityId] }));
    if (assignments.some((a) => !a.membershipId)) {
      window.alert("Select a replacement administrator for every affected community.");
      return;
    }
    await attempt(pendingAction, assignments);
  }

  async function reactivate() {
    const response = await fetch(`/api/master/accounts/${accountId}/reactivate`, { method: "POST" });
    const data = await response.json();
    if (!data.ok) window.alert(`Failed: ${data.reason}`);
    router.refresh();
  }

  async function resetPassword() {
    const response = await fetch(`/api/master/accounts/${accountId}/reset-password`, { method: "POST" });
    const data = await response.json();
    if (data.ok) {
      window.alert(`New temporary password (shown once): ${data.temporaryPassword}`);
    } else {
      window.alert(`Failed: ${data.reason}`);
    }
    router.refresh();
  }

  if (deleted) {
    return <p className="text-sm text-ink-muted">This account has been permanently deleted.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" ? (
          <Button variant="dangerOutline" onClick={() => attempt("suspend")}>
            Suspend
          </Button>
        ) : (
          <Button variant="secondary" onClick={reactivate}>
            Reactivate
          </Button>
        )}
        <Button variant="secondary" onClick={resetPassword}>
          Reset password
        </Button>
        <Button variant="dangerOutline" onClick={() => attempt("delete")}>
          Delete permanently
        </Button>
      </div>

      {affected && (
        <div className="mt-4 rounded-card border border-danger/40 bg-bg p-4">
          <p className="mb-3 text-[13px] font-semibold text-danger">
            This account is the last active administrator of {affected.length} community(ies). Choose a
            replacement administrator for each before continuing:
          </p>
          {affected.map((c) => (
            <label key={c.communityId} className="mb-2 block">
              <span className="mb-1 block text-[13px] font-semibold">{c.communityName}</span>
              <select
                className="w-full rounded-pill bg-surface px-4 py-2 text-[15px]"
                value={chosen[c.communityId] ?? ""}
                onChange={(e) => setChosen((prev) => ({ ...prev, [c.communityId]: e.target.value }))}
              >
                <option value="">Select a replacement…</option>
                {(eligibleByCommunity[c.communityId] ?? []).map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button variant="dangerOutline" className="mt-2" onClick={confirmWithAssignments}>
            Confirm {pendingAction}
          </Button>
        </div>
      )}
    </div>
  );
}
