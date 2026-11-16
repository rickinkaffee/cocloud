import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ComponentType, ReactElement } from "react";

export type ProjectFaviconProject = Pick<
  EnvironmentProject,
  "environmentId" | "workspaceRoot" | "title" | "faviconPath" | "projectIcon"
>;
export function ProjectFavicon(input: {
  project: ProjectFaviconProject;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}): ReactElement | null {
  return null;
}
