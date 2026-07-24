import Link from "next/link";
import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { PageHeader } from "../../_components/PageHeader";
import { Card } from "../../_components/Card";
import { listAccountsForMaster } from "@/server/services/masterAdministrationService";
import { SearchBox } from "./SearchBox";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const master = await requireMasterPage();
  const { search } = await searchParams;
  const result = await listAccountsForMaster({ search });

  return (
    <MasterShell master={master}>
      <PageHeader title="Accounts" subtitle="Edit, suspend, reset, and delete ordinary marketplace accounts." />
      <SearchBox />
      <Card className="min-w-0">
        {result.accounts.length === 0 ? (
          <p className="py-10 text-center text-ink-muted">No accounts match this search.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Email
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Status
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg px-4 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
                    Created at
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      <Link href={`/master/accounts/${a.id}`} className="font-semibold text-brand">
                        {a.email}
                      </Link>
                    </td>
                    <td className="border-b border-border px-4 py-3 last:border-none">
                      {a.deletedAt ? "DELETED" : a.status}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 last:border-none">
                      {dateFormatter.format(a.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </MasterShell>
  );
}
