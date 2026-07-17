"use client";

import { useState } from "react";

export interface MemberRow {
  membershipId: string;
  email: string;
  role: "ADMINISTRATOR" | "MEMBER";
}

type RevokeResponse = { ok: false; reason: "not_administrator" | "not_found" | "last_admin" | "conflict" };

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

  if (members.length === 0) {
    return <p className="operator-empty">No members yet. Invite someone to get started.</p>;
  }

  return (
    <div className="operator-table-wrap">
      <table className="operator-table">
        <colgroup>
          <col />
          <col />
          <col className="operator-table__id-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.membershipId}>
              <td>{member.email}</td>
              <td>{member.role}</td>
              <td>
                <button className="btn-danger-inline" onClick={() => onRevoke(member.membershipId)}>
                  Revoke
                </button>
                {errorByMembership[member.membershipId] && (
                  <p className="form-error" role="status">
                    {errorByMembership[member.membershipId]}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
