import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { OperatorCreateCommunityForm } from "./OperatorCreateCommunityForm";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * FR-016: development-only, disabled-by-default. Gated independently of the
 * route handler (app/api/operator/create-community/route.ts) — either one
 * being reachable does not imply the other is. Never enabled in production.
 */
export default async function OperatorPage() {
  if (process.env.OPERATOR_PANEL_ENABLED !== "true") {
    notFound();
  }

  const communities = await prisma.community.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdByOperator: true, createdAt: true },
  });

  return (
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>Operator panel</h1>
          <p className="operator-notice">Development-only — never enabled in production (FR-016)</p>
        </div>

        <div className="operator-layout">
          <section className="operator-panel-card">
            <h2 className="micro-label">Create a community</h2>
            <OperatorCreateCommunityForm />
          </section>

          <section className="operator-communities">
            <h2 className="micro-label">Existing communities</h2>
            {communities.length === 0 ? (
              <p className="operator-empty">No communities yet. Create one on the left to get started.</p>
            ) : (
              <div className="operator-table-wrap">
                <table className="operator-table">
                  <colgroup>
                    <col />
                    <col className="operator-table__id-col" />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>ID</th>
                      <th>Created by</th>
                      <th>Created at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {communities.map((community) => (
                      <tr key={community.id}>
                        <td>{community.name}</td>
                        <td className="operator-table__id" title={community.id}>
                          {community.id}
                        </td>
                        <td>{community.createdByOperator}</td>
                        <td>{dateFormatter.format(community.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
