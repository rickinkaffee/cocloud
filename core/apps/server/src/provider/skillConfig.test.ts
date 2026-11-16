// @effect-diagnostics nodeBuiltinImport:off
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { setCodexSkillEnabled } from "./CodexProvider.ts";

it.layer(NodeServices.layer)("skill configuration protocol", (it) => {
  it.effect("uses the discovered skill and honors the server's effective value", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const record = cwd + "/writes.jsonl";
      const enabled = yield* setCodexSkillEnabled({
        binaryPath: fileURLToPath(
          new URL("./testFixtures/skillConfigMockPeer.mjs", import.meta.url),
        ),
        cwd,
        homePath: cwd,
        environment: { SKILL_WRITE_RECORD: record },
        path: "/tmp/synthetic-skill/SKILL.md",
        enabled: true,
      });
      expect(enabled).toBe(false);
      expect(JSON.parse((yield* fs.readFileString(record)).trim())).toEqual({
        path: "/tmp/synthetic-skill/SKILL.md",
        enabled: true,
      });
    }),
  );
  it.effect("rejects an undiscovered path before any configuration write", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const record = cwd + "/writes.jsonl";
      const error = yield* setCodexSkillEnabled({
        binaryPath: fileURLToPath(
          new URL("./testFixtures/skillConfigMockPeer.mjs", import.meta.url),
        ),
        cwd,
        homePath: cwd,
        environment: { SKILL_WRITE_RECORD: record },
        path: "/tmp/other/SKILL.md",
        enabled: false,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("CodexSkillNotDiscoveredError");
      expect(yield* fs.exists(record)).toBe(false);
    }),
  );
});
