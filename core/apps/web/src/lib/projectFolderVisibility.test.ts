import { describe, expect, it } from "vite-plus/test";
import { keepEmptyProjectFolders } from "./projectFolderVisibility";
const ref = { environmentId: "server-a", projectId: "example" };
const group = { archived: false, memberProjectRefs: [ref] };
describe("project folder visibility after archive/reload", () => {
  it("keeps a new project visible before its first conversation", () => {
    expect(keepEmptyProjectFolders([])(group)).toBe(true);
  });
  it("hides a project only when separate archived snapshots prove all its conversations archived", () => {
    const snapshots = [
      {
        environmentId: ref.environmentId,
        snapshot: { threads: [{ projectId: ref.projectId, archivedAt: { epoch: 1 } }] },
      },
    ];
    expect(keepEmptyProjectFolders([], snapshots)(group)).toBe(false);
    expect(keepEmptyProjectFolders([{ ...ref, archivedAt: null }], snapshots)(group)).toBe(true);
  });
  it("does not confuse projects on different servers or deleted archive entries", () => {
    const snapshots = [
      {
        environmentId: "server-b",
        snapshot: { threads: [{ projectId: ref.projectId, archivedAt: "date" }] },
      },
    ];
    expect(keepEmptyProjectFolders([], snapshots)(group)).toBe(true);
    expect(
      keepEmptyProjectFolders(
        [],
        [
          {
            environmentId: ref.environmentId,
            snapshot: {
              threads: [{ projectId: ref.projectId, archivedAt: "date", deletedAt: "date" }],
            },
          },
        ],
      )(group),
    ).toBe(true);
    expect(keepEmptyProjectFolders([])({ ...group, archived: true })).toBe(false);
  });
});
