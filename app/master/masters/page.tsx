import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { PageHeader } from "../../_components/PageHeader";
import { Card } from "../../_components/Card";
import { prisma } from "@/lib/prisma";
import { MasterCreateForm } from "./MasterCreateForm";
import { MasterActions } from "./MasterActions";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function MastersPage() {
  const master = await requireMasterPage();

  const masters = await prisma.masterIdentity.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, masterId: true, email: true, status: true, createdAt: true, createdByMasterId: true },
  });

  return (
    <MasterShell master={master}>
      <PageHeader title="Masters" subtitle="Other dedicated platform-operator identities." />
      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Create a MASTER
          </h2>
          <MasterCreateForm />
        </Card>
        <Card className="min-w-0">
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Existing masters
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Master ID
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Status
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Created at
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {masters.map((m) => (
                  <tr key={m.id}>
                    <td className="border-b border-border px-4 py-3 last:border-none">{m.masterId}</td>
                    <td className="border-b border-border px-4 py-3 last:border-none">{m.status}</td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                      {dateFormatter.format(m.createdAt)}
                    </td>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      <MasterActions masterId={m.id} status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </MasterShell>
  );
}
