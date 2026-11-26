type ProjectRef = { environmentId: string; projectId: string };
type Thread = ProjectRef & { archivedAt: string | null; deletedAt?: string | null };
type Group = { archived: boolean; memberProjectRefs: readonly ProjectRef[] };
type ArchivedSnapshot = { environmentId: string; snapshot: { threads: readonly Omit<Thread, "environmentId">[] } };

// Empty is not evidence of archiving: brand-new projects have no threads either.
// Read archived shells separately because live snapshots omit them after reload.
export function keepEmptyProjectFolders(threads: readonly Thread[], snapshots: readonly ArchivedSnapshot[] = []) {
  const active = new Set<string>();
  const archived = new Set<string>();
  const key = (ref: ProjectRef) => JSON.stringify([ref.environmentId, ref.projectId]);
  for (const thread of threads) {
    if (thread.deletedAt != null) continue;
    (thread.archivedAt == null ? active : archived).add(key(thread));
  }
  for (const { environmentId, snapshot } of snapshots) {
    for (const thread of snapshot.threads) {
      if (thread.deletedAt == null && thread.archivedAt != null)
        archived.add(key({ environmentId, projectId: thread.projectId }));
    }
  }
  return (group: Group) => !group.archived && (
    group.memberProjectRefs.some(ref => active.has(key(ref))) ||
    !group.memberProjectRefs.some(ref => archived.has(key(ref)))
  );
}
