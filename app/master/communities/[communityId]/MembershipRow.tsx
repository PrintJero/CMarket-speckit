"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../_components/Button";

interface Membership {
  id: string;
  accountId: string;
  displayName: string | null;
  email: string;
  role: "ADMINISTRATOR" | "MEMBER";
  isCurrent: boolean;
}

export function MembershipRow({ communityId, membership }: { communityId: string; membership: Membership }) {
  const router = useRouter();
  const [showRemove, setShowRemove] = useState(false);

  async function promote() {
    const response = await fetch(
      `/api/master/communities/${communityId}/memberships/${membership.id}/promote`,
      { method: "POST" },
    );
    const data = await response.json();
    if (!data.ok) window.alert(`Failed: ${data.reason}`);
    router.refresh();
  }

  async function remove(disposition: "demote" | "revoke_membership" | "disable_account" | "delete_account") {
    const response = await fetch(`/api/master/communities/${communityId}/memberships/${membership.id}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition }),
    });
    const data = await response.json();
    if (!data.ok) {
      window.alert(`Failed: ${data.reason}`);
    } else {
      setShowRemove(false);
    }
    router.refresh();
  }

  return (
    <tr>
      <td className="border-b border-border px-4 py-3 last:border-none">
        {membership.displayName ?? membership.email}
      </td>
      <td className="border-b border-border px-4 py-3 last:border-none">{membership.role}</td>
      <td className="border-b border-border px-4 py-3 last:border-none">{membership.isCurrent ? "Current" : "Historical"}</td>
      <td className="border-b border-border px-4 py-3 last:border-none">
        {membership.isCurrent && (
          <div className="flex flex-wrap gap-2">
            {membership.role === "MEMBER" && (
              <Button variant="secondary" onClick={promote}>
                Promote
              </Button>
            )}
            {!showRemove ? (
              <Button variant="dangerOutline" onClick={() => setShowRemove(true)}>
                Remove…
              </Button>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={() => remove("demote")}>
                  Demote
                </Button>
                <Button variant="secondary" onClick={() => remove("revoke_membership")}>
                  Revoke membership
                </Button>
                <Button variant="dangerOutline" onClick={() => remove("disable_account")}>
                  Disable account
                </Button>
                <Button variant="dangerOutline" onClick={() => remove("delete_account")}>
                  Delete account
                </Button>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
