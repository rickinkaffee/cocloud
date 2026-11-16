type ProjectRef = { environmentId: string; projectId: string };
type Thread = ProjectRef & { archivedAt: string | null; deletedAt?: string | null };
type Group = { archived: boolean; memberProjectRefs: readonly ProjectRef[] };

// Use all thread shells, before search, scope, collapse and shelf filtering.
// Archived conversations are removed from the live shell snapshot entirely.
// An empty snapshot must therefore hide folders, including after a reload.
export function keepEmptyProjectFolders(threads: readonly Thread[]) {
  const active = new Set<string>();
  const key = (ref: ProjectRef) => JSON.stringify([ref.environmentId, ref.projectId]);
  for (const thread of threads) {
    if (thread.deletedAt != null) continue;
    if (thread.archivedAt == null) active.add(key(thread));
  }
  return (group: Group) => !group.archived &&
    group.memberProjectRefs.some(ref => active.has(key(ref)));
}
