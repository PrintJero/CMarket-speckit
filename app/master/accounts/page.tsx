import Link from "next/link";
import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { MasterPageHeader } from "../_components/MasterPageHeader";
import { MasterSection } from "../_components/MasterSection";
import { MasterTable, masterThClassName, masterTdClassName, masterTrClassName } from "../_components/MasterTable";
import { MasterStatusBadge } from "../_components/MasterStatusBadge";
import { MasterEmptyState } from "../_components/MasterEmptyState";
import { UsersIcon } from "../../_components/icons";
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
      <MasterPageHeader
        title="Accounts"
        subtitle="Edit, suspend, reset, and delete ordinary marketplace accounts."
      />
      <SearchBox />
      {result.accounts.length === 0 ? (
        <MasterSection>
          <MasterEmptyState
            icon={UsersIcon}
            title="No accounts found"
            description={search ? `No account emails contain "${search}".` : "No accounts exist yet."}
          />
        </MasterSection>
      ) : (
        <MasterTable>
          <thead>
            <tr>
              <th className={masterThClassName}>Email</th>
              <th className={masterThClassName}>Status</th>
              <th className={masterThClassName}>Created at</th>
            </tr>
          </thead>
          <tbody>
            {result.accounts.map((a) => (
              <tr key={a.id} className={masterTrClassName}>
                <td className={masterTdClassName}>
                  <Link href={`/master/accounts/${a.id}`} className="font-semibold text-master hover:underline">
                    {a.email}
                  </Link>
                </td>
                <td className={masterTdClassName}>
                  <MasterStatusBadge status={a.deletedAt ? "DELETED" : a.status} />
                </td>
                <td className={`${masterTdClassName} whitespace-nowrap`}>{dateFormatter.format(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </MasterTable>
      )}
    </MasterShell>
  );
}
