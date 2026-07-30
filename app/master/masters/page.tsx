import { requireMasterPage } from "../_lib/requireMasterPage";
import { MasterShell } from "../_components/MasterShell";
import { MasterPageHeader } from "../_components/MasterPageHeader";
import { MasterSection } from "../_components/MasterSection";
import { MasterTable, masterThClassName, masterTdClassName, masterTrClassName } from "../_components/MasterTable";
import { MasterStatusBadge } from "../_components/MasterStatusBadge";
import { MasterEmptyState } from "../_components/MasterEmptyState";
import { prisma } from "@/lib/prisma";
import { MasterCreateForm } from "./MasterCreateForm";
import { MasterActions } from "./MasterActions";
import { ShieldIcon } from "../../_components/icons";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function MastersPage() {
  const master = await requireMasterPage();

  // Same direct-Prisma query the pre-redesign page used, widened only to
  // additionally select mustChangePassword (already on this model, just not
  // previously surfaced in the UI) — no new backend behavior.
  const masters = await prisma.masterIdentity.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      masterId: true,
      email: true,
      status: true,
      createdAt: true,
      createdByMasterId: true,
      mustChangePassword: true,
    },
  });

  return (
    <MasterShell master={master}>
      <MasterPageHeader title="Masters" subtitle="Other dedicated platform-operator identities." />
      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <MasterSection title="Create a MASTER">
          <div className="p-5">
            <MasterCreateForm />
          </div>
        </MasterSection>

        <MasterSection title="Existing masters" className="min-w-0">
          {masters.length === 0 ? (
            <MasterEmptyState
              icon={ShieldIcon}
              title="No MASTER operators yet"
              description="Create the first dedicated platform-operator identity using the form."
            />
          ) : (
            <div className="p-4">
              <MasterTable>
                <thead>
                  <tr>
                    <th className={masterThClassName}>Master ID</th>
                    <th className={masterThClassName}>Email</th>
                    <th className={masterThClassName}>Status</th>
                    <th className={masterThClassName}>Created at</th>
                    <th className={masterThClassName}>Created by</th>
                    <th className={masterThClassName}>Must change password</th>
                    <th className={masterThClassName}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {masters.map((m) => (
                    <tr key={m.id} className={masterTrClassName}>
                      <td className={masterTdClassName}>
                        <span className="font-master-mono font-semibold text-ink">{m.masterId}</span>
                      </td>
                      <td className={masterTdClassName}>{m.email}</td>
                      <td className={masterTdClassName}>
                        <MasterStatusBadge status={m.status} />
                      </td>
                      <td className={`${masterTdClassName} whitespace-nowrap`}>{dateFormatter.format(m.createdAt)}</td>
                      <td className={masterTdClassName}>
                        {m.createdByMasterId ? (
                          <span className="font-master-mono text-[12.5px] text-ink-muted">{m.createdByMasterId}</span>
                        ) : (
                          <span className="text-ink-muted">System</span>
                        )}
                      </td>
                      <td className={masterTdClassName}>
                        {m.mustChangePassword ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning-border bg-warning-tint px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning-dark">
                            Yes
                          </span>
                        ) : (
                          <span className="text-ink-muted">No</span>
                        )}
                      </td>
                      <td className={masterTdClassName}>
                        <MasterActions masterId={m.id} status={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </MasterTable>
            </div>
          )}
        </MasterSection>
      </div>
    </MasterShell>
  );
}
