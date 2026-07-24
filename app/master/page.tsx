import Link from "next/link";
import { requireMasterPage } from "./_lib/requireMasterPage";
import { MasterShell } from "./_components/MasterShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

/**
 * FR-021: navigation only — no transaction analytics, sales rankings, or
 * revenue charts (those are reserved for a later feature, per spec.md's
 * explicit exclusions).
 */
export default async function MasterDashboardPage() {
  const master = await requireMasterPage();

  return (
    <MasterShell master={master}>
      <PageHeader title="Platform administration" subtitle="Separate from the marketplace." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Communities</h2>
          <p className="mb-4 text-sm text-ink-muted">Create, edit, suspend, archive, and restore communities.</p>
          <Link href="/master/communities" className="text-sm font-semibold text-brand">
            View communities →
          </Link>
        </Card>
        <Card>
          <h2 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Accounts</h2>
          <p className="mb-4 text-sm text-ink-muted">Edit, suspend, reset, and delete ordinary accounts.</p>
          <Link href="/master/accounts" className="text-sm font-semibold text-brand">
            View accounts →
          </Link>
        </Card>
        <Card>
          <h2 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Masters</h2>
          <p className="mb-4 text-sm text-ink-muted">Create and manage other platform-operator identities.</p>
          <Link href="/master/masters" className="text-sm font-semibold text-brand">
            View masters →
          </Link>
        </Card>
        <Card>
          <h2 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">Audit log</h2>
          <p className="mb-4 text-sm text-ink-muted">Every platform-administration action, including rejections.</p>
          <Link href="/master/audit-log" className="text-sm font-semibold text-brand">
            View audit log →
          </Link>
        </Card>
      </div>
    </MasterShell>
  );
}
