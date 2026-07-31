"use client";

import { useState } from "react";
import type { MembershipSummary } from "@/lib/auth/currentAccount";
import { Card } from "./Card";

/**
 * 015-navigation-shell-community-selector, FR-001/FR-003/FR-004/FR-005. Renders
 * exactly the memberships already on the account payload — no directory,
 * browse, or join affordance exists anywhere in this component, by
 * construction (there is nothing here to render one from).
 */
export function CommunitySelector({ memberships }: { memberships: MembershipSummary[] }) {
  const [pendingCommunityId, setPendingCommunityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectCommunity(communityId: string) {
    setError(null);
    setPendingCommunityId(communityId);
    const response = await fetch("/api/active-community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communityId }),
    });
    if (!response.ok) {
      setPendingCommunityId(null);
      setError("That community is no longer available. Please try another.");
      return;
    }
    window.location.href = `/communities/${communityId}`;
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-[1.375rem] font-bold text-ink">Choose a community</h1>
      <p className="mb-6 text-[13px] text-ink-muted">Pick which community you want to work in.</p>
      <div className="flex flex-col gap-3">
        {memberships.map((membership) => (
          <Card key={membership.communityId}>
            <button
              type="button"
              disabled={pendingCommunityId !== null}
              onClick={() => selectCommunity(membership.communityId)}
              className="flex w-full items-center justify-between text-left font-semibold text-ink disabled:cursor-default disabled:opacity-60"
            >
              <span className="truncate">{membership.communityName}</span>
              {pendingCommunityId === membership.communityId && (
                <span className="text-[13px] font-normal text-ink-muted">Opening…</span>
              )}
            </button>
          </Card>
        ))}
      </div>
      {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
