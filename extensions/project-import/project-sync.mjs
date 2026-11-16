import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

export async function resolveWorkbenchProject(id, headers) {
  const forwarded = { "x-t3-orchestration-protocol": "2" };
  if (headers.cookie) forwarded.Cookie = headers.cookie;
  if (headers.authorization) forwarded.Authorization = headers.authorization;
  const response = await fetch(new URL("/api/projects", process.env.WORKBENCH_INTERNAL_URL || "http://127.0.0.1:3773"), {
    headers: forwarded,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Project lookup unavailable");
  return (await response.json()).projects.find((p) => p.id === id && !p.deletedAt);
}

export function validRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\\x00-\x1f\x7f:]/.test(path) &&
    path.split("/").every((p) => p && p !== "." && p !== ".." && Buffer.byteLength(p) <= 255)
  );
}

function fingerprint(info) {
  return `${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`;
}

export function createProjectSync({
  root,
  staging,
  fail,
  resolveProject = resolveWorkbenchProject,
  jsonBody,
  now = Date.now,
}) {
  const archiveTickets = new Map();
  const uploadReviews = new Map();
  async function project(id, headers) {
    const record = await resolveProject(id, headers);
    if (!record?.workspaceRoot) fail(404, "project_not_found");
    const path = await NodeFSP.realpath(record.workspaceRoot);
    // The sidecar is deliberately restricted to its systemd writable project root.
    if (
      !path.startsWith(root + NodePath.sep) ||
      path.startsWith(staging + NodePath.sep) ||
      path === staging
    )
      fail(403, "project_outside_sync_root");
    return { path, name: NodePath.basename(path) };
  }

  async function namedProject(name) {
    if (!validRelativePath(name) || name.includes('/') || name === '.cocloud-imports')
      fail(400, 'invalid_folder_name');
    const path = NodePath.join(root, name);
    const info = await NodeFSP.lstat(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!info) return null;
    if (info.isSymbolicLink()) fail(409, 'symlink_conflict');
    if (!info.isDirectory()) fail(409, 'file_directory_conflict');
    return {path, name};
  }

  async function describeNamed(name) {
    const target = await namedProject(name);
    return target ? {exists: true, ...await manifest(target.path, {uploadInventory: true})} : {exists: false};
  }

  function checkReviewed(base, baseVersion, current, selection) {
    if (!selection?.destination) {
      if (typeof baseVersion !== 'string' || current.version !== baseVersion) fail(409, 'sync_conflict');
      return false;
    }
    const reviewed = uploadReviews.get(base + ':' + baseVersion);
    if (!reviewed || now() - reviewed.createdAt > 24 * 60 * 60 * 1000) fail(409, 'sync_conflict');
    const currentFiles = new Map(current.files.map(file => [file.path, file.version]));
    const dirs = new Set(current.directories), skipped = new Set(current.skipped);
    const option = selection.destination;
    for (const file of selection.manifest.files) {
      const path = selection.named || option.placement === 'root' ? file.path : `${option.folderName}/${file.path}`;
      const choice = Object.hasOwn(option.fileConflicts ?? {}, path) ? option.fileConflicts[path] : option.conflict;
      // Keep and skip never replace the reviewed file; their current state is safe.
      if (choice === 'keep' || choice === 'skip') continue;
      if (dirs.has(path) || skipped.has(path) || reviewed.files.get(path) !== currentFiles.get(path)) fail(409, 'sync_conflict');
    }
    return true;
  }

  async function prepareNamed(name, baseVersion, selection) {
    const target = await namedProject(name);
    if (!target) fail(409, 'sync_conflict');
    const current = await manifest(target.path, {uploadInventory: true});
    const scoped = checkReviewed(target.path, baseVersion, current, selection);
    return {importName: name, baseVersion, path: target.path, ...(scoped ? {scoped: true} : {})};
  }

  async function safePath(base, relative, createParents = false) {
    if (!validRelativePath(relative)) fail(400, "invalid_file_path");
    const parts = relative.split("/");
    let current = base;
    for (let i = 0; i < parts.length; i++) {
      current = NodePath.join(current, parts[i]);
      let info;
      try {
        info = await NodeFSP.lstat(current);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (i < parts.length - 1 && createParents) {
          await NodeFSP.mkdir(current, { mode: 0o700 });
          info = await NodeFSP.lstat(current);
        } else if (i < parts.length - 1) {
          return current + NodePath.sep + parts.slice(i + 1).join(NodePath.sep);
        }
      }
      if (info?.isSymbolicLink()) fail(409, "symlink_conflict");
      if (info && i < parts.length - 1 && !info.isDirectory()) fail(409, "file_directory_conflict");
    }
    return current;
  }

  async function manifest(base, { uploadInventory = false } = {}) {
    const files = [],
      directories = [],
      skipped = [];
    let totalBytes = 0,
      entries = 0;
    async function walk(relative) {
      const dir = await NodeFSP.opendir(NodePath.join(base, relative));
      for await (const entry of dir) {
        if (++entries > 100_000 && !uploadInventory) fail(413, "invalid_file_count");
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (!validRelativePath(path)) fail(400, "invalid_file_path");
        const target = NodePath.join(base, ...path.split("/"));
        const info = await NodeFSP.lstat(target, { bigint: true });
        if (info.isSymbolicLink()) {
          skipped.push(path);
          continue;
        }
        await safePath(base, path);
        if (info.isDirectory()) {
          directories.push(path);
          await walk(path);
        } else if (info.isFile()) {
          const size = Number(info.size);
          totalBytes += size;
          if (!uploadInventory && files.length >= 50_000) fail(413, "invalid_file_count");
          if (!uploadInventory && totalBytes > 20 * 1024 ** 3) fail(413, "folder_too_large");
          files.push({ path, size, version: fingerprint(info) });
        } else skipped.push(path);
      }
    }
    // Symlinks are omitted without following their targets, including directory links.
    try {
      await walk("");
    } catch (error) {
      if (error.message === "symlink_conflict") fail(409, "symlink_conflict");
      throw error;
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    directories.sort();
    const version = NodeCrypto.createHash("sha256")
      .update(JSON.stringify({ files, directories }))
      .digest("hex");
    if (uploadInventory) {
      const key = base + ':' + version;
      if (!uploadReviews.has(key)) uploadReviews.set(key, {createdAt: now(), files: new Map(files.map(file => [file.path, file.version]))});
      if (uploadReviews.size > 16) uploadReviews.delete(uploadReviews.keys().next().value);
    }
    return { files, directories, skipped, totalBytes, version };
  }

  async function prepare(id, baseVersion, headers, selection) {
    const target = await project(id, headers);
    const current = await manifest(target.path, {uploadInventory: true});
    const scoped = checkReviewed(target.path, baseVersion, current, selection);
    return { projectId: id, baseVersion, path: target.path, ...(scoped ? {scoped: true} : {}) };
  }

  async function commit(upload, content, headers, persist) {
    const target = upload.target.importName
      ? await namedProject(upload.target.importName)
      : await project(upload.target.projectId, headers);
    if (!target) fail(409, "sync_conflict");
    if (target.path !== upload.target.path) fail(409, "sync_conflict");
    let baseline;
    if (!upload.applied) {
      baseline = await manifest(target.path, {uploadInventory: true});
      if (upload.target.scoped) {
        const currentFiles = new Map(baseline.files.map(file => [file.path, file.version]));
        for (const file of upload.files) {
          if (!Object.hasOwn(upload.target.fileVersions ?? {}, file.path) ||
              (currentFiles.get(file.path) ?? null) !== upload.target.fileVersions[file.path]) fail(409, 'sync_conflict');
        }
      } else if (baseline.version !== upload.target.baseVersion) fail(409, "sync_conflict");
      // Preflight every destination before touching an existing project.
      for (const file of upload.files) {
        const dest = await safePath(target.path, file.path);
        const info = await NodeFSP.lstat(dest).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        });
        if (info && !info.isFile()) fail(409, "file_directory_conflict");
      }
      for (const dir of upload.directories ?? []) {
        const dest = await safePath(target.path, dir);
        const info = await NodeFSP.lstat(dest).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        });
        if (info && !info.isDirectory()) fail(409, "file_directory_conflict");
      }
      upload.applied = [];
      await persist();
    } else if (upload.applied.length !== upload.files.length) {
      // A service interruption must not silently retry a partially applied merge.
      fail(409, "sync_partial");
    }
    for (const dir of upload.directories ?? []) {
      const dest = await safePath(target.path, dir, true);
      await NodeFSP.mkdir(dest, { recursive: true, mode: 0o700 });
    }
    const baselineFiles = new Map(baseline?.files.map(file => [file.path, file]) ?? []);
    for (const file of upload.files.slice(upload.applied.length)) {
      const dest = await safePath(target.path, file.path, true);
      const source = NodePath.join(content, ...file.path.split("/"));
      const backup = NodePath.join(staging, upload.id, "backup", ...file.path.split("/"));
      await NodeFSP.mkdir(NodePath.dirname(backup), { recursive: true, mode: 0o700 });
      const old = await NodeFSP.lstat(dest).catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (old) {
        await NodeFSP.copyFile(dest, backup, NodeFS.constants.COPYFILE_EXCL);
        await NodeFSP.chmod(source, old.mode & 0o777);
      }
      const expected = baselineFiles.get(file.path);
      const latest = await NodeFSP.lstat(dest, { bigint: true }).catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (expected ? !latest || fingerprint(latest) !== expected.version : latest !== null)
        fail(409, "sync_conflict");
      await NodeFSP.rename(source, dest);
      upload.applied.push(file.path);
      await persist();
    }
    return target.path;
  }

  async function handle(request, response, url, reply) {
    const match = url.pathname.match(
      /^\/api\/cocloud\/imports\/sync\/([^/]+)\/(manifest|file|archive|properties|download)$/,
    );
    if (
      !match ||
      (request.method !== "GET" && !(request.method === "POST" && match[2] === "archive"))
    )
      return false;
    const projectId = decodeURIComponent(match[1]);
    const target = await project(projectId, request.headers);
    if (match[2] === "properties" || match[2] === "download") {
      const relative = url.searchParams.get("path");
      const file = await safePath(target.path, relative);
      const info = await NodeFSP.lstat(file).catch(error => {
        if (error.code === "ENOENT") fail(404, "file_not_found");
        throw error;
      });
      if (!info.isFile() && !info.isDirectory()) fail(400, "unsupported_file_type");
      if (match[2] === "properties") {
        let size = info.isFile() ? info.size : 0, files = 0, directories = 0, skipped = 0;
        if (info.isDirectory()) {
          let count = 0;
          async function walk(path) {
            for await (const entry of await NodeFSP.opendir(path)) {
              if (++count > 100000) fail(413, "folder_too_large");
              const child = NodePath.join(path, entry.name), stat = await NodeFSP.lstat(child);
              if (stat.isFile()) { size += stat.size; files++; }
              else if (stat.isDirectory()) { directories++; await walk(child); }
              else skipped++;
            }
          }
          await walk(file);
        }
        reply(200, {name: NodePath.basename(file), path: file, location: NodePath.dirname(file),
          kind: info.isDirectory() ? "directory" : "file", size, files, directories, skipped,
          modifiedAt: info.mtime.toISOString(), accessedAt: info.atime.toISOString(),
          createdAt: info.birthtimeMs > 0 ? info.birthtime.toISOString() : null,
          mode: (info.mode & 0o777).toString(8)});
        return true;
      }
      const name = NodePath.basename(file) + (info.isDirectory() ? ".tar.gz" : "");
      if (info.isDirectory()) {
        const tar = NodeChildProcess.spawn("tar", ["-czf", "-", "--", NodePath.basename(file)],
          {cwd: NodePath.dirname(file), stdio: ["ignore", "pipe", "pipe"]});
        tar.stderr.resume();
        tar.on("error", () => response.destroy());
        const done = NodeEvents.once(tar, "close");
        response.on("close", () => { if (tar.exitCode === null) tar.kill(); });
        response.writeHead(200, {"Content-Type": "application/gzip", "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="folder.tar.gz"; filename*=UTF-8''${encodeURIComponent(name)}`});
        tar.stdout.pipe(response, {end: false});
        const [code] = await done;
        if (code === 0) response.end(); else response.destroy();
      } else {
        const handle = await NodeFSP.open(file, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
        const current = await handle.stat();
        if (!current.isFile()) { await handle.close(); fail(409, "file_changed"); }
        response.writeHead(200, {"Content-Type": "application/octet-stream", "Content-Length": current.size,
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`});
        const stream = handle.createReadStream();
        stream.on("error", () => response.destroy());
        response.on("close", () => stream.destroy());
        stream.pipe(response);
      }
      return true;
    }
    if (match[2] === "manifest") {
      reply(200, { ...(await manifest(target.path, {uploadInventory: url.searchParams.get("purpose") === "upload"})), name: target.name });
      return true;
    }
    if (match[2] === "archive") {
      const snapshot = await manifest(target.path);
      for (const [key, value] of archiveTickets)
        if (value.expiresAt <= now()) archiveTickets.delete(key);
      if (request.method === "POST") {
        const body = await jsonBody(request);
        if (body?.version !== snapshot.version) fail(409, "sync_conflict");
        const available = new Set([
          ...snapshot.directories,
          ...snapshot.files.map((file) => file.path),
        ]);
        if (
          !Array.isArray(body.paths) ||
          (body.paths.length === 0 && (available.size > 0 || snapshot.skipped.length > 0)) ||
          body.paths.length > 100_000 ||
          body.paths.some((path) => !validRelativePath(path) || !available.has(path)) ||
          new Set(body.paths).size !== body.paths.length
        )
          fail(400, "invalid_file_selection");
        const paths = new Set(body.paths);
        for (const path of body.paths) {
          const parts = path.split("/");
          for (let index = 1; index < parts.length; index++)
            paths.add(parts.slice(0, index).join("/"));
        }
        if (archiveTickets.size >= 1000) fail(429, "too_many_downloads");
        const ticket = NodeCrypto.randomBytes(32).toString("hex");
        archiveTickets.set(ticket, {
          projectId,
          version: snapshot.version,
          path: target.path,
          paths: [...paths],
          emptyRoot: paths.size === 0,
          expiresAt: now() + 5 * 60_000,
        });
        reply(200, { ticket });
        return true;
      }
      const ticket = url.searchParams.get("ticket");
      const selection = archiveTickets.get(ticket);
      if (!selection || selection.projectId !== projectId) fail(400, "download_ticket_invalid");
      archiveTickets.delete(ticket);
      if (selection.version !== snapshot.version || selection.path !== target.path)
        fail(409, "sync_conflict");
      for (const path of selection.paths) await safePath(target.path, path);
      const tar = NodeChildProcess.spawn(
        "tar",
        ["-czf", "-", "--no-recursion", "--null", "--verbatim-files-from", "-T", "-"],
        {
          cwd: selection.emptyRoot ? NodePath.dirname(target.path) : target.path,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      tar.stderr.resume();
      tar.stdin.on("error", () => response.destroy());
      tar.on("error", () => response.destroy());
      response.writeHead(200, {
        "Content-Type": "application/gzip",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="project.tar.gz"; filename*=UTF-8''${encodeURIComponent(target.name)}.tar.gz`,
      });
      const done = NodeEvents.once(tar, "close");
      response.on("close", () => {
        if (tar.exitCode === null) tar.kill();
      });
      tar.stdout.pipe(response, { end: false });
      for (const path of selection.emptyRoot ? [target.name] : selection.paths) {
        if (!tar.stdin.write(path + "\0")) await NodeEvents.once(tar.stdin, "drain");
      }
      tar.stdin.end();
      const [code] = await done;
      if (code === 0) response.end();
      else response.destroy();
      return true;
    }
    const path = url.searchParams.get("path");
    const file = await safePath(target.path, path);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, "invalid_chunk");
    const handle = await NodeFSP.open(
      file,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    );
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || fingerprint(info) !== url.searchParams.get("version"))
        fail(409, "sync_conflict");
      const size = Number(info.size);
      if (offset > size) fail(400, "invalid_chunk");
      const buffer = Buffer.alloc(Math.min(8 * 1024 ** 2, size - offset));
      let read = 0;
      while (read < buffer.length) {
        const r = await handle.read(buffer, read, buffer.length - read, offset + read);
        if (!r.bytesRead) fail(409, "sync_conflict");
        read += r.bytesRead;
      }
      if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(info))
        fail(409, "sync_conflict");
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": buffer.length,
      });
      response.end(buffer);
      return true;
    } finally {
      await handle.close();
    }
  }
  return { handle, prepare, prepareNamed, describeNamed, checkReviewed, commit, manifest };
}
