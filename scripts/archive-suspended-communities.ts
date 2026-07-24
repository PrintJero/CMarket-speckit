import { archiveDueSuspendedCommunities } from "@/server/services/communityLifecycleService";

/**
 * research.md #7: intended to run on a Dokploy-scheduled cron (e.g. daily)
 * — no in-process scheduler is added to this repo. Idempotent: running it
 * more often than needed, or more than once for the same community, is
 * harmless (FR-058).
 */
async function main(): Promise<void> {
  const result = await archiveDueSuspendedCommunities();
  if (result.archivedCommunityIds.length === 0) {
    console.log("No communities due for archival.");
    return;
  }
  console.log(`Archived ${result.archivedCommunityIds.length} community(ies): ${result.archivedCommunityIds.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
