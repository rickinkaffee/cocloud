import { useAtomValue } from "@effect/atom-react";
import { AuthProvidersManageScope, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentScope } from "../state/session";

export function SkillManagementSection({ environmentId }: { environmentId: EnvironmentId }) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const update = useAtomCommand(serverEnvironment.setSkillEnabled, "Update skill");
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, "Refresh skills");
  const [pending, setPending] = useState<string | null>(null);
  return (
    <details className="px-3 py-2 text-xs">
      <summary>技能 / Skills</summary>
      <button
        type="button"
        disabled={pending !== null}
        className="my-2 underline"
        onClick={async () => {
          setPending("refresh");
          try {
            await refresh({ environmentId, input: { fresh: true } });
          } finally {
            setPending(null);
          }
        }}
      >
        刷新 / Refresh
      </button>
      {providers
        .filter((provider) => provider.driver === "codex" && provider.enabled)
        .map((provider) => {
          const inventory = new Map(
            provider.skills.map((skill) => [
              skill.path,
              { skill, cwd: undefined as string | undefined },
            ]),
          );
          for (const workspace of provider.workspaceSnapshots ?? [])
            for (const skill of workspace.skills)
              inventory.set(skill.path, { skill, cwd: workspace.cwd });
          return (
            <div key={provider.instanceId} className="my-2">
              <strong>{provider.displayName ?? "Codex"}</strong>
              {inventory.size === 0 && (
                <p className="text-muted-foreground">尚未发现技能 / No skills discovered</p>
              )}
              {[...inventory.values()].map(({ skill, cwd }) => (
                <label key={skill.path} className="mt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={skill.enabled !== false}
                    disabled={!canManage || pending !== null}
                    onChange={async (event) => {
                      const enabled = event.target.checked;
                      setPending(skill.path);
                      try {
                        await update({
                          environmentId,
                          input: {
                            instanceId: provider.instanceId,
                            path: skill.path,
                            enabled,
                            ...(cwd ? { cwd } : {}),
                          },
                        });
                      } finally {
                        setPending(null);
                      }
                    }}
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
          );
        })}
    </details>
  );
}
