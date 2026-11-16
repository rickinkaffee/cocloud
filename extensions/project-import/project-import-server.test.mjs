import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import * as NodeChildProcess from "node:child_process";
import { createImportServer, validateManifest } from "./project-import-server.mjs";

NodeTest.test(
  "manifest rejects traversal, duplicate or conflicting paths and enforces limits",
  () => {
    for (const name of ["..", "../escape", "C:\\escape", ".cocloud-imports", " "])
      NodeAssert.throws(() => validateManifest({ name, files: [{ path: "a", size: 1 }] }));
    for (const path of ["../secret", "/root/secret", "a/../b", "a\\b", "C:/a", "a//b", "a/\u0000b"])
      NodeAssert.throws(() => validateManifest({ name: "sample", files: [{ path, size: 1 }] }));
    NodeAssert.throws(() =>
      validateManifest({
        name: "sample",
        files: [
          { path: "a", size: 0 },
          { path: "a/b", size: 1 },
        ],
      }),
    );
    NodeAssert.throws(() =>
      validateManifest({
        name: "sample",
        files: [
          { path: "a", size: 0 },
          { path: "a", size: 1 },
        ],
      }),
    );
    NodeAssert.throws(() => validateManifest({ name: "sample", files: [{ path: "a", size: -1 }] }));
    NodeAssert.throws(() =>
      validateManifest({ name: "sample", files: [{ path: "a", size: 21 * 1024 ** 3 }] }),
    );
    NodeAssert.equal(
      validateManifest({ name: "中文项目", files: [{ path: ".git/config", size: 0 }] }).name,
      "中文项目",
    );
  },
);

async function fixture(t, options = {}) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "cocloud-folder-import-"));
  const authenticate = async (headers) => ({
    authenticated: !!headers.authorization,
    permissions:
      headers.authorization === "reader"
        ? ["filesystem:read", "orchestration:read"]
        : headers.authorization === "limited"
          ? ["filesystem:read"]
          : ["filesystem:read", "orchestration:read", "filesystem:write", "orchestration:operate"],
    cookies: ["migrated=1; HttpOnly; SameSite=Strict"],
  });
  const server = await createImportServer({
    ...options,
    root,
    authenticate,
    publicOrigin: "https://workbench.test",
    resolveProject: async (id) =>
      id === "outside"
        ? { workspaceRoot: NodeOS.tmpdir() }
        : id === "missing"
          ? null
          : { workspaceRoot: NodePath.join(root, id) },
  });
  server.listen(0, "127.0.0.1");
  await NodeEvents.once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/cocloud/imports`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await NodeFSP.rm(root, { recursive: true, force: true });
  });
  const call = (path = "", init = {}) =>
    fetch(base + path, {
      ...init,
      headers: { Authorization: "admin", "X-Cocloud-Import": "1", ...init.headers },
    });
  const start = async (name, files) => {
    const response = await call("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, files }),
    });
    NodeAssert.equal(response.status, 201);
    return response.json();
  };
  return { root, call, start };
}

NodeTest.test(
  "project sync merges binary files, retains destination-only files, backs up replaced files and preserves empty folders",
  async (t) => {
    const { root, call } = await fixture(t);
    const dir = NodePath.join(root, "existing");
    await NodeFSP.mkdir(dir);
    await NodeFSP.writeFile(NodePath.join(dir, "replace"), "original");
    await NodeFSP.writeFile(NodePath.join(dir, "keep"), "server-only");
    const initial = await (await call("/sync/existing/manifest")).json();
    const body = {
      name: "existing",
      projectId: "existing",
      baseVersion: initial.version,
      directories: ["empty/nested"],
      files: [
        { path: "replace", size: 4 },
        { path: "nested/binary", size: 3 },
      ],
    };
    const started = await call("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    NodeAssert.equal(started.status, 201);
    const { id } = await started.json();
    NodeAssert.equal(
      (await call(`/${id}/files/0?offset=0`, { method: "PUT", body: "next" })).status,
      200,
    );
    NodeAssert.equal(
      (await call(`/${id}/files/1?offset=0`, { method: "PUT", body: Buffer.from([0, 255, 128]) }))
        .status,
      200,
    );
    const committed = await call(`/${id}/commit`, { method: "POST" });
    NodeAssert.equal(committed.status, 200);
    NodeAssert.equal((await committed.json()).path, dir);
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir, "replace"), "utf8"), "next");
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir, "keep"), "utf8"), "server-only");
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(root, ".cocloud-imports", id, "backup/replace"), "utf8"),
      "original",
    );
    NodeAssert.equal((await NodeFSP.stat(NodePath.join(dir, "empty/nested"))).isDirectory(), true);
    NodeAssert.equal((await call(`/${id}/commit`, { method: "POST" })).status, 200);
    const manifest = await (await call("/sync/existing/manifest")).json();
    const binary = manifest.files.find((f) => f.path === "nested/binary");
    const query = new URLSearchParams({ path: binary.path, version: binary.version, offset: "1" });
    const downloaded = await call(`/sync/existing/file?${query}`);
    NodeAssert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from([255, 128]));
    await NodeFSP.writeFile(NodePath.join(dir, "nested/binary"), "changed");
    NodeAssert.equal((await call(`/sync/existing/file?${query}`)).status, 409);
    NodeAssert.equal((await call("/sync/outside/manifest")).status, 403);
    NodeAssert.equal((await call("/sync/missing/manifest")).status, 404);
    NodeAssert.equal(
      (await call("/sync/existing/manifest", { headers: { Authorization: "limited" } })).status,
      403,
    );
    NodeAssert.equal((await call("/sync/existing/file?path=../secret&version=x")).status, 400);
  },
);

NodeTest.test(
  "project sync detects edits during staging and refuses file-directory and symlink conflicts",
  async (t) => {
    const { root, call } = await fixture(t);
    const dir = NodePath.join(root, "existing");
    await NodeFSP.mkdir(dir);
    await NodeFSP.writeFile(NodePath.join(dir, "keep"), "old");
    const initial = await (await call("/sync/existing/manifest")).json();
    const start = (baseVersion, files, directories = []) =>
      call("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "existing",
          projectId: "existing",
          baseVersion,
          files,
          directories,
        }),
      });
    const { id } = await (await start(initial.version, [{ path: "keep", size: 3 }])).json();
    await call(`/${id}/files/0?offset=0`, { method: "PUT", body: "new" });
    await NodeFSP.writeFile(NodePath.join(dir, "keep"), "server edit");
    NodeAssert.equal((await call(`/${id}/commit`, { method: "POST" })).status, 409);
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir, "keep"), "utf8"), "server edit");
    NodeAssert.equal((await start(initial.version, [])).status, 409);
    const next = await (await call("/sync/existing/manifest")).json();
    const conflict = await (await start(next.version, [], ["keep/nested"])).json();
    NodeAssert.equal((await call(`/${conflict.id}/commit`, { method: "POST" })).status, 409);
    // oxlint-disable-next-line t3code/no-global-process-runtime -- exercises native symlinks only where this dependency-free sidecar can create them
    if (NodeOS.platform() !== "win32") {
      await NodeFSP.symlink(NodeOS.tmpdir(), NodePath.join(dir, "escape"));
      const links = await (await call("/sync/existing/manifest")).json();
      NodeAssert.deepEqual(links.skipped, ["escape"]);
      const linked = await (await start(links.version, [{ path: "escape/file", size: 0 }])).json();
      await call(`/${linked.id}/files/0?offset=0`, { method: "PUT", body: Buffer.alloc(0) });
      NodeAssert.equal((await call(`/${linked.id}/commit`, { method: "POST" })).status, 409);
      NodeAssert.equal((await call("/sync/existing/archive")).status, 400);
    }
  },
);

NodeTest.test(
  "archive tickets include only selected paths and reject stale, expired or reused downloads",
  async (t) => {
    let time = 1;
    const { root, call } = await fixture(t, { now: () => time });
    const dir = NodePath.join(root, "existing");
    await NodeFSP.mkdir(NodePath.join(dir, "nested"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(dir, "empty"));
    await NodeFSP.writeFile(NodePath.join(dir, "nested/selected.txt"), "chosen");
    await NodeFSP.writeFile(NodePath.join(dir, "nested/other.txt"), "untouched");
    const manifest = () => call("/sync/existing/manifest").then((r) => r.json());
    const initial = await manifest();
    const create = (paths, version = initial.version, headers = {}) =>
      call("/sync/existing/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ version, paths }),
      });
    for (const paths of [[], ["../secret"], ["missing"], ["empty", "empty"]])
      NodeAssert.equal((await create(paths)).status, 400);
    NodeAssert.equal((await create(["empty"], "stale")).status, 409);
    NodeAssert.equal(
      (await create(["empty"], initial.version, { Authorization: "limited" })).status,
      403,
    );
    NodeAssert.equal(
      (await create(["empty"], initial.version, { Origin: "https://other.test" })).status,
      403,
    );
    NodeAssert.equal(
      (await create(["empty"], initial.version, { "X-Cocloud-Import": "" })).status,
      403,
    );
    const response = await create(["nested/selected.txt", "empty"], initial.version, {
      Authorization: "reader",
    });
    NodeAssert.equal(response.status, 200);
    const { ticket } = await response.json();
    NodeAssert.equal((await call(`/sync/missing/archive?ticket=${ticket}`)).status, 404);
    NodeAssert.equal(
      (
        await call(`/sync/existing/archive?ticket=${ticket}`, {
          headers: { Authorization: "limited" },
        })
      ).status,
      403,
    );
    const archive = await call(`/sync/existing/archive?ticket=${ticket}`, {
      headers: { Authorization: "reader" },
    });
    NodeAssert.equal(archive.status, 200);
    const archivePath = NodePath.join(root, "selected.tar.gz");
    await NodeFSP.writeFile(archivePath, Buffer.from(await archive.arrayBuffer()));
    const listed = NodeChildProcess.spawnSync("tar", ["-tzf", "-"], {
      input: await NodeFSP.readFile(archivePath),
      encoding: "utf8",
    });
    NodeAssert.equal(listed.status, 0, listed.stderr);
    NodeAssert.deepEqual(listed.stdout.trim().split(/\r?\n/).sort(), [
      "empty/",
      "nested/",
      "nested/selected.txt",
    ]);
    NodeAssert.equal((await call(`/sync/existing/archive?ticket=${ticket}`)).status, 400);
    const expired = await (await create(["empty"])).json();
    time += 5 * 60_000;
    NodeAssert.equal((await call(`/sync/existing/archive?ticket=${expired.ticket}`)).status, 400);
    const stale = await (await create(["empty"])).json();
    await NodeFSP.writeFile(NodePath.join(dir, "nested/selected.txt"), "edited");
    NodeAssert.equal((await call(`/sync/existing/archive?ticket=${stale.ticket}`)).status, 409);
    const next = await manifest();
    const parentOnly = await (await create(["nested"], next.version)).json();
    const parentArchive = await call(`/sync/existing/archive?ticket=${parentOnly.ticket}`);
    await NodeFSP.writeFile(archivePath, Buffer.from(await parentArchive.arrayBuffer()));
    const parentList = NodeChildProcess.spawnSync("tar", ["-tzf", "-"], {
      input: await NodeFSP.readFile(archivePath),
      encoding: "utf8",
    });
    NodeAssert.equal(parentList.status, 0, parentList.stderr);
    NodeAssert.equal(parentList.stdout.trim(), "nested/");
  },
);

NodeTest.test("empty projects can be created and preserve empty directory structure", async (t) => {
  const { root, call, start } = await fixture(t);
  const empty = await start("root-only", []);
  const committed = await call(`/${empty.id}/commit`, { method: "POST" });
  NodeAssert.equal(committed.status, 200);
  NodeAssert.equal((await NodeFSP.stat(NodePath.join(root, "root-only"))).isDirectory(), true);
  NodeAssert.deepEqual(await NodeFSP.readdir(NodePath.join(root, "root-only")), []);
  NodeAssert.equal((await call(`/${empty.id}/commit`, { method: "POST" })).status, 200);
  const manifest = await (await call("/sync/root-only/manifest")).json();
  const ticketResponse = await call("/sync/root-only/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: manifest.version, paths: [] }),
  });
  NodeAssert.equal(ticketResponse.status, 200);
  const { ticket } = await ticketResponse.json();
  const archive = await call(`/sync/root-only/archive?ticket=${ticket}`);
  NodeAssert.equal(archive.status, 200);
  const listed = NodeChildProcess.spawnSync("tar", ["-tzf", "-"], {
    input: Buffer.from(await archive.arrayBuffer()),
    encoding: "utf8",
  });
  NodeAssert.equal(listed.status, 0, listed.stderr);
  NodeAssert.equal(listed.stdout.trim(), "root-only/");
  await NodeFSP.writeFile(NodePath.join(root, "root-only/keep.txt"), "keep");
  const next = await (await call("/sync/root-only/manifest")).json();
  const update = await call("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "root-only",
      projectId: "root-only",
      baseVersion: next.version,
      files: [],
      directories: [],
    }),
  });
  NodeAssert.equal(update.status, 201);
  const merge = await update.json();
  NodeAssert.equal((await call(`/${merge.id}/commit`, { method: "POST" })).status, 200);
  NodeAssert.equal(
    await NodeFSP.readFile(NodePath.join(root, "root-only/keep.txt"), "utf8"),
    "keep",
  );
  const response = await call("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "empty", files: [], directories: ["a/b"] }),
  });
  NodeAssert.equal(response.status, 201);
  const { id } = await response.json();
  NodeAssert.equal((await call(`/${id}/commit`, { method: "POST" })).status, 200);
  NodeAssert.equal((await NodeFSP.stat(NodePath.join(root, "empty/a/b"))).isDirectory(), true);
});

NodeTest.test(
  "requires login, filesystem scope, same origin and explicit import header",
  async (t) => {
    const { call, root } = await fixture(t);
    NodeAssert.equal((await call("/config", { headers: { Authorization: "" } })).status, 401);
    NodeAssert.equal(
      (await call("/config", { headers: { Authorization: "limited" } })).status,
      403,
    );
    NodeAssert.equal(
      (await call("/config", { headers: { Origin: "https://other.test" } })).status,
      403,
    );
    NodeAssert.equal(
      (await call("", { method: "POST", headers: { "X-Cocloud-Import": "" } })).status,
      403,
    );
    const response = await call("/config");
    NodeAssert.equal(response.status, 200);
    NodeAssert.equal((await response.json()).root, await NodeFSP.realpath(root));
    NodeAssert.match(response.headers.get("set-cookie"), /migrated=1/);
  },
);

NodeTest.test(
  "uploads binary chunks, dotfiles, unicode and empty files; commit is idempotent and never overwrites",
  async (t) => {
    const { call, start, root } = await fixture(t);
    await NodeFSP.mkdir(NodePath.join(root, "示例项目"));
    await NodeFSP.writeFile(NodePath.join(root, "示例项目", "keep.txt"), "unchanged");
    const image = Buffer.from([0, 255, 34, 13, 10, 128, 1]);
    const text = Buffer.from("中文内容\nhello\n");
    const files = [
      { path: "assets/image.bin", size: image.length },
      { path: ".git/config", size: text.length },
      { path: "空文件.txt", size: 0 },
    ];
    const upload = await start("示例项目", files);
    NodeAssert.equal((await call(`/${upload.id}/commit`, { method: "POST" })).status, 409);
    NodeAssert.equal(
      (await call(`/${upload.id}/files/0?offset=0`, { method: "PUT", body: image.subarray(0, 3) }))
        .status,
      200,
    );
    NodeAssert.equal(
      (await call(`/${upload.id}/files/0?offset=0`, { method: "PUT", body: image.subarray(0, 3) }))
        .status,
      409,
    );
    NodeAssert.deepEqual((await (await call(`/${upload.id}`)).json()).offsets, [3, 0, 0]);
    NodeAssert.equal(
      (await call(`/${upload.id}/files/0?offset=3`, { method: "PUT", body: image.subarray(3) }))
        .status,
      200,
    );
    NodeAssert.equal(
      (await call(`/${upload.id}/files/1?offset=0`, { method: "PUT", body: text })).status,
      200,
    );
    NodeAssert.equal(
      (await call(`/${upload.id}/files/2?offset=0`, { method: "PUT", body: Buffer.alloc(0) }))
        .status,
      200,
    );
    const committed = await (await call(`/${upload.id}/commit`, { method: "POST" })).json();
    NodeAssert.equal(committed.name, "示例项目-2");
    NodeAssert.deepEqual(
      await NodeFSP.readFile(NodePath.join(committed.path, "assets/image.bin")),
      image,
    );
    NodeAssert.deepEqual(
      await NodeFSP.readFile(NodePath.join(committed.path, ".git/config")),
      text,
    );
    NodeAssert.equal((await NodeFSP.stat(NodePath.join(committed.path, "空文件.txt"))).size, 0);
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(root, "示例项目", "keep.txt"), "utf8"),
      "unchanged",
    );
    NodeAssert.deepEqual(
      await (await call(`/${upload.id}/commit`, { method: "POST" })).json(),
      committed,
    );
    NodeAssert.equal((await call(`/${upload.id}`, { method: "DELETE" })).status, 200);
    NodeAssert.deepEqual(
      await NodeFSP.readFile(NodePath.join(committed.path, "assets/image.bin")),
      image,
    );
  },
);

NodeTest.test(
  "cancel removes only staging files and invalid chunks never become project files",
  async (t) => {
    const { call, start, root } = await fixture(t);
    const upload = await start("cancelled", [{ path: "test.txt", size: 2 }]);
    NodeAssert.equal(
      (await call(`/${upload.id}/files/0?offset=0`, { method: "PUT", body: "too long" })).status,
      400,
    );
    NodeAssert.equal(
      (await call(`/${upload.id}/files/0?offset=0`, { method: "PUT", body: "ok" })).status,
      200,
    );
    NodeAssert.equal((await call(`/${upload.id}`, { method: "DELETE" })).status, 200);
    await NodeAssert.rejects(NodeFSP.stat(NodePath.join(root, "cancelled")), { code: "ENOENT" });
    await NodeAssert.rejects(NodeFSP.stat(NodePath.join(root, ".cocloud-imports", upload.id)), {
      code: "ENOENT",
    });
    NodeAssert.equal((await call(`/${upload.id}/commit`, { method: "POST" })).status, 404);
  },
);
