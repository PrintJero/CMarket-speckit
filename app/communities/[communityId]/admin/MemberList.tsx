"use client";

import { useState } from "react";
import { Button } from "../../../_components/Button";
import { FormError } from "../../../_components/FormField";

export interface MemberRow {
  membershipId: string;
  email: string;
  role: "ADMINISTRATOR" | "MEMBER";
}

type RevokeResponse = { ok: false; reason: "not_administrator" | "not_found" | "last_admin" | "conflict" };
type PromoteResponse = { ok: false; reason: "not_administrator" | "not_eligible" };

export function MemberList({
  communityId,
  initialMembers,
}: {
  communityId: string;
  initialMembers: MemberRow[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [errorByMembership, setErrorByMembership] = useState<Record<string, string>>({});

  async function onRevoke(membershipId: string) {
    setErrorByMembership((prev) => ({ ...prev, [membershipId]: "" }));

    const response = await fetch(`/api/communities/${communityId}/memberships/${membershipId}`, {
      method: "DELETE",
    });

    if (response.status === 204) {
      setMembers((prev) => prev.filter((member) => member.membershipId !== membershipId));
      return;
    }

    const data: RevokeResponse = await response.json();
    setErrorByMembership((prev) => ({ ...prev, [membershipId]: data.reason }));
  }

  /** 009-platform-administration, User Story 6: promote an existing active member to administrator. */
  async function onPromote(membershipId: string) {
    setErrorByMembership((prev) => ({ ...prev, [membershipId]: "" }));

    const response = await fetch(`/api/communities/${communityId}/memberships/${membershipId}/promote`, {
      method: "POST",
    });
    const data = await response.json();

    if (data.ok) {
      setMembers((prev) =>
        prev.map((member) => (member.membershipId === membershipId ? { ...member, role: "ADMINISTRATOR" } : member)),
      );
      return;
    }
    setErrorByMembership((prev) => ({ ...prev, [membershipId]: (data as PromoteResponse).reason }));
  }

  if (members.length === 0) {
    return <p className="py-10 text-center text-ink-muted">No members yet. Invite someone to get started.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[420px] table-fixed border-collapse text-sm">
        <thead>
          <tr>
            <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
              Email
            </th>
            <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
              Role
            </th>
            <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.membershipId}>
              <td className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                {member.email}
              </td>
              <td className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                {member.role}
              </td>
              <td className="border-b border-border px-4 py-3 last:border-none">
                <div className="flex gap-2">
                  {member.role === "MEMBER" && (
                    <Button variant="secondary" onClick={() => onPromote(member.membershipId)}>
                      Promote
                    </Button>
                  )}
                  <Button variant="dangerOutline" onClick={() => onRevoke(member.membershipId)}>
                    Revoke
                  </Button>
                </div>
                {errorByMembership[member.membershipId] && (
                  <FormError>{errorByMembership[member.membershipId]}</FormError>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
