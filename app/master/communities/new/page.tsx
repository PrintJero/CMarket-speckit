import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";
import { CreateCommunityForm } from "./CreateCommunityForm";

export default async function NewCommunityPage() {
  const master = await requireMasterPage();

  return (
    <MasterShell master={master}>
      <PageHeader title="Create a community" subtitle="Assigns a founding administrator in the same atomic action." />
      <Card className="max-w-xl">
        <CreateCommunityForm />
      </Card>
    </MasterShell>
  );
}
