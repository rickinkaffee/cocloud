import * as NodeOS from "node:os";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import { authenticateWorkbench } from "./workbench-auth.mjs";
import { createProjectSync, validRelativePath } from "./project-sync.mjs";

const PREFIX = "/api/cocloud/imports";
const CHUNK = 8 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_BYTES = 20 * 1024 ** 3;
const MAX_MANIFEST = 24 * 1024 ** 2;
const EXPIRES = 24 * 60 * 60 * 1000;

class ImportError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
const fail = (status, code) => {
  throw new ImportError(status, code);
};

export function validateManifest(value) {
  const name = value?.name;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    Buffer.byteLength(name) > 180 ||
    [".", "..", ".cocloud-imports"].includes(name.trim()) ||
    /[\\/\x00-\x1f\x7f]/.test(name) ||
    /^[A-Za-z]:/.test(name)
  )
    fail(400, "invalid_folder_name");
  if (!Array.isArray(value.files) || value.files.length > MAX_FILES)
    fail(400, "invalid_file_count");
  const paths = new Set();
  let totalBytes = 0;
  const files = value.files.map((file) => {
    const path = file?.path;
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 4096 ||
      path.startsWith("/") ||
      /[\\\x00-\x1f\x7f]/.test(path) ||
      /^[A-Za-z]:/.test(path) ||
      path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255)
    )
      fail(400, "invalid_file_path");
    if (paths.has(path)) fail(400, "duplicate_file_path");
    paths.add(path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_BYTES)
      fail(400, "invalid_file_size");
    totalBytes += file.size;
    if (totalBytes > MAX_BYTES) fail(413, "folder_too_large");
    return {
      path,
      size: file.size,
      lastModified: Number.isSafeInteger(file.lastModified) ? file.lastModified : 0,
    };
  });
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++)
      if (paths.has(parts.slice(0, i).join("/"))) fail(400, "file_directory_conflict");
  }
  const directories = value.directories ?? [];
  if (
    !Array.isArray(directories) ||
    directories.length + files.length > 100_000 ||
    directories.some(
      (path) =>
        !validRelativePath(path) ||
        paths.has(path) ||
        path.split("/").some((_, i, parts) => paths.has(parts.slice(0, i + 1).join("/"))),
    )
  )
    fail(400, "invalid_file_path");
  return { name: name.trim(), files, directories: [...new Set(directories)], totalBytes };
}

async function jsonBody(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) fail(415, "json_required");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_MANIFEST) fail(413, "manifest_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "invalid_json");
  }
}

export async function createImportServer({
  authenticate = authenticateWorkbench,
  root = process.env.WORKBENCH_PROJECTS || "/var/lib/open-workbench/projects",
  publicOrigin = process.env.COCLOUD_PUBLIC_ORIGIN ?? "https://workbench.example",
  now = Date.now,
  resolveProject,
} = {}) {
  await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
  root = await NodeFSP.realpath(root);
  const staging = NodePath.join(root, ".cocloud-imports");
  await NodeFSP.mkdir(staging, { recursive: true, mode: 0o700 });
  if ((await NodeFSP.lstat(staging)).isSymbolicLink()) throw new Error("Unsafe staging directory");
  const sync = createProjectSync({ root, staging, fail, resolveProject, jsonBody, now });
  const locks = new Map();
  async function locked(id, run) {
    const previous = locks.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(run);
    locks.set(id, task);
    try {
      return await task;
    } finally {
      if (locks.get(id) === task) locks.delete(id);
    }
  }
  const statePath = (id) => NodePath.join(staging, id, "state.json");
  async function state(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, "upload_not_found");
    let value;
    try {
      value = JSON.parse(await NodeFSP.readFile(statePath(id), "utf8"));
    } catch {
      fail(404, "upload_not_found");
    }
    if (now() - value.createdAt > EXPIRES) fail(410, "upload_expired");
    return value;
  }
  async function persist(id, value) {
    const temp = `${statePath(id)}.tmp`;
    await NodeFSP.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await NodeFSP.rename(temp, statePath(id));
  }
  async function cleanup() {
    for (const entry of await NodeFSP.readdir(staging, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name) || locks.has(entry.name))
        continue;
      try {
        const info = await NodeFSP.stat(statePath(entry.name));
        const value = JSON.parse(await NodeFSP.readFile(statePath(entry.name), "utf8"));
        if (now() - info.mtimeMs > EXPIRES && !value.applied)
          await NodeFSP.rm(NodePath.join(staging, entry.name), { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  await cleanup();
  const cleanupTimer = setInterval(() => void cleanup().catch(() => {}), 60 * 60 * 1000);
  cleanupTimer.unref();
  const server = NodeHttp.createServer(async (request, response) => {
    const reply = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
        return reply(404, { error: "not_found" });
      if (request.headers.origin && request.headers.origin !== publicOrigin)
        return reply(403, { error: "origin_not_allowed" });
      const auth = await authenticate(request.headers);
      if (auth.cookies?.length) response.setHeader("Set-Cookie", auth.cookies);
      if (!auth.authenticated) return reply(401, { error: "authentication_required" });
      const scopes = auth.permissions ?? auth.scopes ?? [];
      const isSyncRead =
        url.pathname.startsWith(`${PREFIX}/sync/`) &&
        (request.method === "GET" ||
          (request.method === "POST" && url.pathname.endsWith("/archive")));
      if (
        isSyncRead
          ? !scopes.includes("filesystem:read") || !scopes.includes("orchestration:read")
          : !scopes.includes("filesystem:write") || !scopes.includes("orchestration:operate")
      )
        return reply(403, { error: "scope_required" });
      if (request.method !== "GET" && request.headers["x-cocloud-import"] !== "1")
        return reply(403, { error: "import_header_required" });
      if (await sync.handle(request, response, url, reply)) return;
      if (url.pathname === `${PREFIX}/config` && request.method === "GET")
        return reply(200, { root, maxFiles: MAX_FILES, maxBytes: MAX_BYTES, chunkBytes: CHUNK });
      if (url.pathname === PREFIX && request.method === "POST") {
        const body = await jsonBody(request);
        const manifest = validateManifest(body);
        const target = body.projectId
          ? await sync.prepare(body.projectId, body.baseVersion, request.headers)
          : null;
        const space = await NodeFSP.statfs(root);
        if (space.bavail * space.bsize < manifest.totalBytes + 256 * 1024 ** 2)
          fail(507, "insufficient_disk_space");
        const id = NodeCrypto.randomUUID();
        await NodeFSP.mkdir(NodePath.join(staging, id, "content"), {
          recursive: true,
          mode: 0o700,
        });
        await persist(id, { ...manifest, target, id, createdAt: now(), committed: null });
        return reply(201, {
          id,
          name: manifest.name,
          totalBytes: manifest.totalBytes,
          fileCount: manifest.files.length,
        });
      }
      const match = url.pathname.match(
        /^\/api\/cocloud\/imports\/([0-9a-f-]{36})(?:\/(files)\/(\d+)|(\/commit))?$/,
      );
      if (!match) return reply(404, { error: "not_found" });
      const id = match[1];
      const result = await locked(id, async () => {
        const upload = await state(id);
        if (request.method === "GET" && !match[2] && !match[4]) {
          const offsets = [];
          for (const file of upload.files) {
            try {
              offsets.push(
                (
                  await NodeFSP.stat(
                    NodePath.join(
                      upload.committed ?? NodePath.join(staging, id, "content"),
                      ...file.path.split("/"),
                    ),
                  )
                ).size,
              );
            } catch {
              offsets.push(0);
            }
          }
          return { offsets, committed: upload.committed };
        }
        if (request.method === "DELETE" && !match[2] && !match[4]) {
          if (!upload.committed && !upload.applied)
            await NodeFSP.rm(NodePath.join(staging, id), { recursive: true, force: true });
          return { cancelled: true };
        }
        if (request.method === "PUT" && match[2] === "files") {
          if (upload.committed) fail(409, "upload_already_committed");
          const file = upload.files[Number(match[3])];
          if (!file) fail(404, "file_not_found");
          const offset = Number(url.searchParams.get("offset"));
          const length = Number(request.headers["content-length"]);
          if (
            !url.searchParams.has("offset") ||
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > CHUNK ||
            offset + length > file.size
          )
            fail(400, "invalid_chunk");
          const target = NodePath.join(staging, id, "content", ...file.path.split("/"));
          await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true, mode: 0o700 });
          let handle;
          try {
            handle = await NodeFSP.open(
              target,
              NodeFS.constants.O_RDWR |
                NodeFS.constants.O_CREAT |
                NodeFS.constants.O_EXCL |
                NodeFS.constants.O_NOFOLLOW,
              0o600,
            );
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            handle = await NodeFSP.open(
              target,
              NodeFS.constants.O_RDWR | NodeFS.constants.O_NOFOLLOW,
            );
          }
          let received = 0;
          try {
            const current = (await handle.stat()).size;
            if (current !== offset) fail(409, "offset_mismatch");
            try {
              for await (const chunk of request) {
                if (received + chunk.length > length) fail(413, "chunk_too_large");
                let position = 0;
                while (position < chunk.length) {
                  const written = await handle.write(
                    chunk,
                    position,
                    chunk.length - position,
                    offset + received + position,
                  );
                  if (!written.bytesWritten) throw new Error("File write failed");
                  position += written.bytesWritten;
                }
                received += chunk.length;
              }
              if (received !== length) fail(400, "incomplete_chunk");
              if (offset + received === file.size && file.lastModified > 0) {
                const time = new Date(file.lastModified);
                await handle.utimes(time, time);
              }
            } catch (error) {
              await handle.truncate(offset);
              throw error;
            }
          } finally {
            await handle.close();
          }
          return { offset: offset + received };
        }
        if (request.method === "POST" && match[4] === "/commit") {
          if (upload.committed)
            return {
              path: upload.committed,
              name: NodePath.basename(upload.committed),
              fileCount: upload.files.length,
              totalBytes: upload.totalBytes,
            };
          for (const file of upload.files) {
            if (upload.applied?.includes(file.path)) continue;
            const target = NodePath.join(staging, id, "content", ...file.path.split("/"));
            let info;
            try {
              info = await NodeFSP.lstat(target);
            } catch {
              fail(409, "upload_incomplete");
            }
            if (!info.isFile() || info.size !== file.size) fail(409, "upload_incomplete");
          }
          const content = NodePath.join(staging, id, "content");
          for (const dir of upload.directories ?? [])
            await NodeFSP.mkdir(NodePath.join(content, ...dir.split("/")), {
              recursive: true,
              mode: 0o700,
            });
          if (upload.target) {
            return locked(`project:${upload.target.projectId}`, async () => {
              upload.committed = await sync.commit(upload, content, request.headers, () =>
                persist(id, upload),
              );
              await persist(id, upload);
              return {
                path: upload.committed,
                name: NodePath.basename(upload.committed),
                fileCount: upload.files.length,
                totalBytes: upload.totalBytes,
              };
            });
          }
          let destination;
          for (let suffix = 1; suffix < 10000; suffix++) {
            const candidate = NodePath.join(
              root,
              `${upload.name}${suffix === 1 ? "" : `-${suffix}`}`,
            );
            try {
              await NodeFSP.mkdir(candidate, { mode: 0o700 });
              destination = candidate;
              break;
            } catch (error) {
              if (error.code !== "EEXIST") throw error;
            }
          }
          if (!destination) fail(409, "folder_name_conflict");
          try {
            // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone Node sidecar has no Effect runtime dependency
            if (NodeOS.platform() === "win32") await NodeFSP.rmdir(destination);
            await NodeFSP.rename(NodePath.join(staging, id, "content"), destination);
          } catch (error) {
            await NodeFSP.rmdir(destination).catch(() => {});
            throw error;
          }
          upload.committed = destination;
          await persist(id, upload);
          return {
            path: destination,
            name: NodePath.basename(destination),
            fileCount: upload.files.length,
            totalBytes: upload.totalBytes,
          };
        }
        fail(405, "method_not_allowed");
      });
      return reply(200, result);
    } catch (error) {
      const status =
        error instanceof ImportError ? error.status : error.code === "ENOSPC" ? 507 : 503;
      return reply(status, {
        error:
          error instanceof ImportError
            ? error.message
            : status === 507
              ? "insufficient_disk_space"
              : "import_unavailable",
      });
    }
  });
  server.requestTimeout = 180_000;
  server.on("close", () => clearInterval(cleanupTimer));
  return server;
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  const server = await createImportServer();
  server.listen(3775, "127.0.0.1");
  const stop = () => {
    server.close();
    server.closeIdleConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
