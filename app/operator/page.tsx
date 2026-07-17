import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { OperatorCreateCommunityForm } from "./OperatorCreateCommunityForm";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * FR-016: development-only, disabled-by-default. Gated independently of the
 * route handler (app/api/operator/create-community/route.ts) — either one
 * being reachable does not imply the other is. Never enabled in production.
 * Fetches the signed-in account only to feed AppShell's sidebar — it stays
 * env-flag-gated, not session-gated, exactly as before.
 */
export default async function OperatorPage() {
  if (process.env.OPERATOR_PANEL_ENABLED !== "true") {
    notFound();
  }

  const account = await getCurrentAccount();

  const communities = await prisma.community.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdByOperator: true, createdAt: true },
  });

  return (
    <AppShell account={account}>
      <PageHeader title="Operator panel" subtitle="Development-only — never enabled in production (FR-016)" />

      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Create a community
          </h2>
          <OperatorCreateCommunityForm />
        </Card>

        <Card className="min-w-0">
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Existing communities
          </h2>
          {communities.length === 0 ? (
            <p className="py-10 text-center text-ink-muted">No communities yet. Create one on the left to get started.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col />
                  <col className="w-[180px]" />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                      Name
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                      ID
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                      Created by
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                      Created at
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {communities.map((community) => (
                    <tr key={community.id}>
                      <td className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                        {community.name}
                      </td>
                      <td
                        className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 font-mono text-[13px] text-ink-muted last:border-none"
                        title={community.id}
                      >
                        {community.id}
                      </td>
                      <td className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                        {community.createdByOperator}
                      </td>
                      <td className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                        {dateFormatter.format(community.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
