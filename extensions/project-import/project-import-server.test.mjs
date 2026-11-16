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

async function uploadPlaced(call, body, contents) {
  const created = await call('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  NodeAssert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
  const {id} = await created.json();
  for (let index = 0; index < contents.length; index++) {
    const response = await call(`/${id}/files/${index}?offset=0`, {method:'PUT', body:contents[index]});
    NodeAssert.equal(response.status, 200);
  }
  const response = await call(`/${id}/commit`, {method:'POST'});
  NodeAssert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return response.json();
}

for (const placement of ['folder', 'root']) {
  NodeTest.test(`folder upload ${placement}: merges folders and chooses per file; keep renames only files`, async t => {
    const {root, call} = await fixture(t);
    const dir = NodePath.join(root, 'existing');
    const prefix = placement === 'folder' ? 'incoming/' : '';
    await NodeFSP.mkdir(NodePath.join(dir, prefix, 'nested'), {recursive:true});
    for (const [path, data] of [['nested/a.txt','old-a'],['nested/b.txt','old-b'],['nested/a (2).txt','already'],['only.txt','server-only']])
      await NodeFSP.writeFile(NodePath.join(dir,prefix,path),data);
    const before = await (await call('/sync/existing/manifest')).json();
    await uploadPlaced(call, {
      name:'existing', projectId:'existing', baseVersion:before.version,
      destination:{placement,folderName:'incoming',conflict:'keep',fileConflicts:{[prefix+'nested/a.txt']:'keep',[prefix+'nested/b.txt']:'overwrite'}},
      directories:['empty'], files:[{path:'nested/a.txt',size:5},{path:'nested/b.txt',size:5},{path:'new.txt',size:3}],
    },['new-a','new-b','new']);
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'nested/a.txt'),'utf8'),'old-a');
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'nested/a (2).txt'),'utf8'),'already');
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'nested/a (3).txt'),'utf8'),'new-a');
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'nested/b.txt'),'utf8'),'new-b');
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'only.txt'),'utf8'),'server-only');
    NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,prefix,'new.txt'),'utf8'),'new');
    NodeAssert.ok((await NodeFSP.stat(NodePath.join(dir,prefix,'empty'))).isDirectory());
    NodeAssert.equal((await NodeFSP.readdir(dir)).includes('incoming-2'),false);
  });
}

NodeTest.test('new-project folder import merges existing folder and keeps duplicate files without creating numbered folders',async t=>{
  const {root,call}=await fixture(t);
  await NodeFSP.mkdir(NodePath.join(root,'同名项目','nested'),{recursive:true});
  await NodeFSP.writeFile(NodePath.join(root,'同名项目','nested','记录.txt'),'old');
  const status=await (await call('/destination?name='+encodeURIComponent('同名项目'))).json();
  NodeAssert.equal(status.exists,true);
  await uploadPlaced(call,{name:'同名项目',destination:{placement:'folder',conflict:'keep',baseVersion:status.version},
    files:[{path:'nested/记录.txt',size:3},{path:'nested/new.txt',size:3}]},['new','new']);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'同名项目','nested','记录.txt'),'utf8'),'old');
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'同名项目','nested','记录 (2).txt'),'utf8'),'new');
  NodeAssert.equal((await NodeFSP.readdir(root)).includes('同名项目-2'),false);
});

NodeTest.test('placement refuses stale previews, changed project destinations, symlink escapes and invalid policy',async t=>{
  const {root,call}=await fixture(t);
  await NodeFSP.mkdir(NodePath.join(root,'existing'));
  await NodeFSP.writeFile(NodePath.join(root,'existing','a'),'old');
  const old=await (await call('/sync/existing/manifest')).json();
  await NodeFSP.writeFile(NodePath.join(root,'existing','b'),'change');
  const send=body=>call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const base={name:'existing',projectId:'existing',baseVersion:old.version,files:[{path:'a',size:3}],destination:{placement:'root',conflict:'overwrite'}};
  NodeAssert.equal((await send(base)).status,409);
  const fresh=await (await call('/sync/existing/manifest')).json();
  NodeAssert.equal((await send({...base,baseVersion:fresh.version,destination:{placement:'invalid',conflict:'overwrite'}})).status,400);
  await NodeFSP.symlink(NodeOS.tmpdir(),NodePath.join(root,'linked'));
  NodeAssert.equal((await call('/destination?name=linked')).status,409);
  NodeAssert.equal((await call('/destination?name=..')).status,400);
  NodeAssert.equal((await call('/destination?name=existing',{headers:{Authorization:'reader'}})).status,403);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'existing','a'),'utf8'),'old');
});

NodeTest.test('keep-both names cannot collide with another selected incoming filename',async t=>{
  const {root,call}=await fixture(t);
  await NodeFSP.mkdir(NodePath.join(root,'existing'));
  await NodeFSP.writeFile(NodePath.join(root,'existing','.env'),'old');
  const old=await (await call('/sync/existing/manifest')).json();
  await uploadPlaced(call,{name:'existing',projectId:'existing',baseVersion:old.version,
    destination:{placement:'root',conflict:'keep'},files:[{path:'.env',size:3},{path:'.env (2)',size:5}]},['new','other']);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'existing','.env (3)'),'utf8'),'new');
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'existing','.env (2)'),'utf8'),'other');
});

NodeTest.test('new-folder placement refuses a destination created during upload instead of silently numbering or merging',async t=>{
  const {root,call}=await fixture(t);
  const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'raced',files:[{path:'a',size:3}],destination:{placement:'folder',conflict:'keep'}})});
  NodeAssert.equal(response.status,201);
  const {id}=await response.json();
  await call(`/${id}/files/0?offset=0`,{method:'PUT',body:'new'});
  await NodeFSP.mkdir(NodePath.join(root,'raced'));
  await NodeFSP.writeFile(NodePath.join(root,'raced','a'),'original');
  NodeAssert.equal((await call(`/${id}/commit`,{method:'POST'})).status,409);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'raced','a'),'utf8'),'original');
  NodeAssert.equal((await NodeFSP.readdir(root)).includes('raced-2'),false);
});

NodeTest.test('upload limits measure 9,137 incoming files / 84 MiB, not the existing 21 GiB project',async t=>{
  const {root,call}=await fixture(t);
  const dir=NodePath.join(root,'existing');
  await NodeFSP.mkdir(dir);
  const large=NodePath.join(dir,'existing-large.bin');
  await NodeFSP.writeFile(large,'');
  await NodeFSP.truncate(large,21*1024**3); // Sparse: no 21 GiB allocation or transfer.
  NodeAssert.equal((await call('/sync/existing/manifest')).status,413,'download retains its transfer limit');
  const previewResponse=await call('/sync/existing/manifest?purpose=upload');
  NodeAssert.equal(previewResponse.status,200);
  const preview=await previewResponse.json();
  NodeAssert.equal(preview.totalBytes,21*1024**3);
  const count=9137,total=84*1024**2,unit=Math.floor(total/count);
  const files=Array.from({length:count},(_,index)=>({path:`incoming/${index}.bin`,size:index===count-1?total-unit*(count-1):unit}));
  const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'existing',projectId:'existing',baseVersion:preview.version,files,destination:{placement:'root',conflict:'keep'}})});
  NodeAssert.equal(response.status,201,JSON.stringify(await response.clone().json()));
  const staged=await response.json();
  NodeAssert.equal(staged.totalBytes,total);NodeAssert.equal(staged.fileCount,count);
  await call(`/${staged.id}`,{method:'DELETE'});
  await uploadPlaced(call,{name:'existing',projectId:'existing',baseVersion:preview.version,
    files:[{path:'new.txt',size:3}],destination:{placement:'root',conflict:'keep'}},['new']);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,'new.txt'),'utf8'),'new');
  NodeAssert.equal((await NodeFSP.stat(large)).size,21*1024**3);
  const rejected=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'too-large',files:[{path:'a',size:21*1024**3}]})});
  NodeAssert.equal((await rejected.json()).error,'invalid_file_size','actual oversize incoming payload is still rejected');
});

NodeTest.test('existing projects above 50,000 files allow small uploads; count overflow is never a 20 GiB error',async t=>{
  const {root,call}=await fixture(t);
  const dir=NodePath.join(root,'existing');await NodeFSP.mkdir(dir);
  for(let start=0;start<50001;start+=128)
    await Promise.all(Array.from({length:Math.min(128,50001-start)},(_,index)=>NodeFSP.writeFile(NodePath.join(dir,`${start+index}.txt`),'')));
  const limited=await call('/sync/existing/manifest');
  NodeAssert.equal(limited.status,413);
  NodeAssert.equal((await limited.json()).error,'invalid_file_count');
  const preview=await (await call('/sync/existing/manifest?purpose=upload')).json();
  NodeAssert.equal(preview.files.length,50001);NodeAssert.equal(preview.totalBytes,0);
  const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'existing',projectId:'existing',baseVersion:preview.version,files:[{path:'new.txt',size:3}]})});
  NodeAssert.equal(response.status,201);
  await call(`/${(await response.json()).id}`,{method:'DELETE'});
  const rejected=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'too-many',files:Array.from({length:50001},(_,index)=>({path:`${index}`,size:0}))})});
  NodeAssert.equal((await rejected.json()).error,'invalid_file_count');
});

NodeTest.test('file tree properties and streamed downloads: exact metadata, Unicode, directories and access boundaries', async t => {
  const {root, call} = await fixture(t);
  const dir = NodePath.join(root, 'existing'); await NodeFSP.mkdir(dir);
  const folder = NodePath.join(dir, '资料'); await NodeFSP.mkdir(folder);
  const file = NodePath.join(folder, '报告 & 结果.txt'); const bytes = Buffer.from('中文\0binary\n');
  await NodeFSP.writeFile(file, bytes);
  const time = new Date('2024-02-03T04:05:06Z'); await NodeFSP.utimes(file, time, time);
  const suffix = '?path=' + encodeURIComponent('资料/报告 & 结果.txt');
  const metadata = await (await call('/sync/existing/properties' + suffix, {headers: {Authorization: 'reader'}})).json();
  NodeAssert.equal(metadata.path, file); NodeAssert.equal(metadata.size, bytes.length);
  NodeAssert.equal(metadata.location, folder); NodeAssert.equal(metadata.modifiedAt, time.toISOString()); NodeAssert.equal(metadata.kind, 'file');
  const download = await call('/sync/existing/download' + suffix, {headers: {Authorization: 'reader'}});
  NodeAssert.equal(download.status, 200); NodeAssert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  NodeAssert.ok(download.headers.get('content-disposition').includes(encodeURIComponent('报告 & 结果.txt')));
  const summary = await (await call('/sync/existing/properties?path=' + encodeURIComponent('资料'))).json();
  NodeAssert.equal(summary.size, bytes.length); NodeAssert.equal(summary.files, 1); NodeAssert.equal(summary.kind, 'directory');
  const archive = Buffer.from(await (await call('/sync/existing/download?path=' + encodeURIComponent('资料'))).arrayBuffer());
  const unpacked = NodeChildProcess.spawnSync('tar', ['-xzOf', '-', '资料/报告 & 结果.txt'], {input: archive});
  NodeAssert.equal(unpacked.status, 0); NodeAssert.deepEqual(unpacked.stdout, bytes);
  await NodeFSP.symlink(NodeOS.tmpdir(), NodePath.join(dir, 'link'));
  for (const action of ['properties', 'download']) {
    NodeAssert.equal((await call('/sync/existing/' + action + suffix, {headers: {Authorization: ''}})).status, 401);
    NodeAssert.equal((await call('/sync/existing/' + action + suffix, {headers: {Authorization: 'limited'}})).status, 403);
    NodeAssert.equal((await call('/sync/existing/' + action + '?path=../escape')).status, 400);
    NodeAssert.equal((await call('/sync/existing/' + action + '?path=link/secret')).status, 409);
    NodeAssert.equal((await call('/sync/existing/' + action + '?path=missing')).status, 404);
    NodeAssert.equal((await call('/sync/outside/' + action + '?path=file')).status, 403);
  }
});

NodeTest.test('per-file status distinguishes missing empty files from accepted empty chunks',async t=>{
  const {call}=await fixture(t);
  const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'offset-status',files:[{path:'empty',size:0},{path:'next',size:3}]})});
  const {id}=await response.json();
  NodeAssert.deepEqual(await (await call(`/${id}/files/0`)).json(),{offset:0,exists:false,committed:false});
  NodeAssert.equal((await call(`/${id}/files/0?offset=0`,{method:'PUT',body:''})).status,200);
  NodeAssert.deepEqual(await (await call(`/${id}/files/0`)).json(),{offset:0,exists:true,committed:false});
  NodeAssert.equal((await call(`/${id}/files/99`)).status,404);
});

NodeTest.test('overwrite checkpoint journal survives restart and refuses partial re-application',async t=>{
  const root=await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(),'cocloud-upload-journal-'));
  const config={root,authenticate:async()=>({authenticated:true,permissions:['filesystem:write','orchestration:operate','filesystem:read','orchestration:read']}),resolveProject:async()=>({workspaceRoot:NodePath.join(root,'existing')})};
  let server,base;
  const start=async()=>{server=await createImportServer(config);server.listen(0,'127.0.0.1');await NodeEvents.once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/cocloud/imports`;};
  const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  const call=(path,init={})=>fetch(base+path,{...init,headers:{'X-Cocloud-Import':'1',...init.headers}});
  t.after(async()=>{if(server.listening)await close();await NodeFSP.rm(root,{recursive:true,force:true});});
  await NodeFSP.mkdir(NodePath.join(root,'existing'));await start();
  const preview=await (await call('/sync/existing/manifest?purpose=upload')).json();
  const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'existing',projectId:'existing',baseVersion:preview.version,files:[{path:'a',size:3},{path:'b',size:3}]})});
  const {id}=await response.json();
  await call(`/${id}/files/0?offset=0`,{method:'PUT',body:'new'});
  await call(`/${id}/files/1?offset=0`,{method:'PUT',body:'new'});
  await close();
  const stage=NodePath.join(root,'.cocloud-imports',id),statePath=NodePath.join(stage,'state.json');
  const state=JSON.parse(await NodeFSP.readFile(statePath,'utf8'));state.applied=[];
  await NodeFSP.writeFile(statePath,JSON.stringify(state));
  await NodeFSP.rename(NodePath.join(stage,'content','a'),NodePath.join(root,'existing','a'));
  await NodeFSP.writeFile(NodePath.join(stage,'applied.jsonl'),JSON.stringify('a')+'\n'+JSON.stringify('b').slice(0,2));
  await start();
  const result=await call(`/${id}/commit`,{method:'POST'});
  NodeAssert.equal(result.status,409);NodeAssert.equal((await result.json()).error,'sync_partial');
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'existing','a'),'utf8'),'new');
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(stage,'content','b'),'utf8'),'new');
});

NodeTest.test('identical folder retry resumes partial files across server restart and isolates changed payloads',async t=>{
  const root=await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(),'cocloud-upload-resume-'));
  const config={root,authenticate:async()=>({authenticated:true,permissions:['filesystem:write','orchestration:operate']})};
  let server,base;
  const start=async()=>{server=await createImportServer(config);server.listen(0,'127.0.0.1');await NodeEvents.once(server,'listening');base=`http://127.0.0.1:${server.address().port}/api/cocloud/imports`;};
  const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  t.after(async()=>{if(server.listening)await close();await NodeFSP.rm(root,{recursive:true,force:true});});
  const call=(path,init={})=>fetch(base+path,{...init,headers:{'X-Cocloud-Import':'1',...init.headers}});
  const payload={name:'resume',files:[{path:'first.txt',size:5},{path:'partial.txt',size:5},{path:'empty',size:0}],destination:{placement:'folder',conflict:'keep'}};
  const begin=body=>call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  await start();const initial=await (await begin(payload)).json();
  await call(`/${initial.id}/files/0?offset=0`,{method:'PUT',body:'hello'});
  await call(`/${initial.id}/files/1?offset=0`,{method:'PUT',body:'wo'});
  await call(`/${initial.id}/files/2?offset=0`,{method:'PUT',body:''});
  await close();await start();
  const resumedResponse=await begin(payload);NodeAssert.equal(resumedResponse.status,201);
  const resumed=await resumedResponse.json();NodeAssert.equal(resumed.id,initial.id);
  NodeAssert.equal(resumed.resumed,true);NodeAssert.deepEqual(resumed.offsets,[5,2,0]);NodeAssert.deepEqual(resumed.exists,[true,true,true]);
  const changed=await (await begin({...payload,files:[{path:'other',size:1}]})).json();NodeAssert.notEqual(changed.id,initial.id);
  await call(`/${initial.id}/files/1?offset=2`,{method:'PUT',body:'rld'});
  const result=await call(`/${initial.id}/commit`,{method:'POST'});NodeAssert.equal(result.status,200);
  NodeAssert.equal(await NodeFSP.readFile(NodePath.join(root,'resume','partial.txt'),'utf8'),'world');
});

for(const placement of ['root','folder'])NodeTest.test(`skip/overwrite/keep choices merge folders and preserve skipped files (${placement})`,async t=>{
 const {root,call}=await fixture(t);const prefix=placement==='folder'?'incoming/':'';
 await NodeFSP.mkdir(NodePath.join(root,'existing',prefix,'nested'),{recursive:true});
 for(const path of ['skip.txt','overwrite.txt','keep.txt'])await NodeFSP.writeFile(NodePath.join(root,'existing',prefix,'nested',path),'old');
 const current=await (await call('/sync/existing/manifest?purpose=upload')).json();
 const decisions={[prefix+'nested/skip.txt']:'skip',[prefix+'nested/overwrite.txt']:'overwrite',[prefix+'nested/keep.txt']:'keep'};
 await uploadPlaced(call,{name:'existing',projectId:'existing',baseVersion:current.version,destination:{placement,folderName:'incoming',conflict:'skip',fileConflicts:decisions},
 files:[{path:'nested/skip.txt',size:3},{path:'nested/overwrite.txt',size:3},{path:'nested/keep.txt',size:3},{path:'nested/new.txt',size:3}]},['new','new','new']);
 const read=path=>NodeFSP.readFile(NodePath.join(root,'existing',prefix,'nested',path),'utf8');
 NodeAssert.equal(await read('skip.txt'),'old');NodeAssert.equal(await read('overwrite.txt'),'new');NodeAssert.equal(await read('keep.txt'),'old');NodeAssert.equal(await read('keep (2).txt'),'new');NodeAssert.equal(await read('new.txt'),'new');
});

for(const named of [false,true])NodeTest.test(`overwrite ignores unrelated project changes during review and transfer (${named?'named import':'project'})`,async t=>{
 const {root,call}=await fixture(t);const dir=NodePath.join(root,'existing');await NodeFSP.mkdir(dir);
 await NodeFSP.writeFile(NodePath.join(dir,'replace.txt'),'old');await NodeFSP.writeFile(NodePath.join(dir,'server.log'),'before');
 const review=await (await call(named?'/destination?name=existing':'/sync/existing/manifest?purpose=upload')).json();
 await NodeFSP.writeFile(NodePath.join(dir,'server.log'),'changed while choosing overwrite');
 const payload={name:'existing',...named?{}:{projectId:'existing',baseVersion:review.version},destination:{placement:'root',conflict:'overwrite',fileConflicts:{'replace.txt':'overwrite'},...named?{placement:'folder',baseVersion:review.version}:{}},files:[{path:'replace.txt',size:3}]};
 const response=await call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 NodeAssert.equal(response.status,201,JSON.stringify(await response.clone().json()));const {id}=await response.json();
 await call(`/${id}/files/0?offset=0`,{method:'PUT',body:'new'});
 await NodeFSP.writeFile(NodePath.join(dir,'server.log'),'changed again during transfer');
 await NodeFSP.writeFile(NodePath.join(dir,'unrelated-new.txt'),'keep');
 const commit=await call(`/${id}/commit`,{method:'POST'});NodeAssert.equal(commit.status,200,JSON.stringify(await commit.clone().json()));
 NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,'replace.txt'),'utf8'),'new');
 NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,'server.log'),'utf8'),'changed again during transfer');
});

NodeTest.test('scoped overwrite still refuses selected files changed during review or transfer',async t=>{
 const {root,call}=await fixture(t);const dir=NodePath.join(root,'existing');await NodeFSP.mkdir(dir);await NodeFSP.writeFile(NodePath.join(dir,'a'),'old');
 const send=body=>call('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const payload=version=>({name:'existing',projectId:'existing',baseVersion:version,destination:{placement:'root',conflict:'overwrite'},files:[{path:'a',size:3}]});
 const review=await (await call('/sync/existing/manifest?purpose=upload')).json();
 await NodeFSP.writeFile(NodePath.join(dir,'a'),'concurrent edit');
 NodeAssert.equal((await send(payload(review.version))).status,409);
 const fresh=await (await call('/sync/existing/manifest?purpose=upload')).json();
 const response=await send(payload(fresh.version));NodeAssert.equal(response.status,201);const {id}=await response.json();
 await call(`/${id}/files/0?offset=0`,{method:'PUT',body:'new'});
 await NodeFSP.writeFile(NodePath.join(dir,'a'),'another edit during upload');
 NodeAssert.equal((await call(`/${id}/commit`,{method:'POST'})).status,409);
 NodeAssert.equal(await NodeFSP.readFile(NodePath.join(dir,'a'),'utf8'),'another edit during upload');
});
