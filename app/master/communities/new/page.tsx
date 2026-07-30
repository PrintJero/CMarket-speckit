import { requireMasterPage } from "../../_lib/requireMasterPage";
import { MasterShell } from "../../_components/MasterShell";
import { MasterPageHeader } from "../../_components/MasterPageHeader";
import { MasterSection } from "../../_components/MasterSection";
import { CreateCommunityForm } from "./CreateCommunityForm";

export default async function NewCommunityPage() {
  const master = await requireMasterPage();

  return (
    <MasterShell master={master}>
      <MasterPageHeader
        title="Create a community"
        subtitle="Assigns a founding administrator in the same atomic action."
        breadcrumb={[{ label: "Communities", href: "/master/communities" }, { label: "Create" }]}
      />
      <MasterSection className="max-w-xl">
        <div className="p-5">
          <CreateCommunityForm />
        </div>
      </MasterSection>
    </MasterShell>
  );
}
