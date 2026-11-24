import * as React from "react";
import { useFolderUpload, readUploadManifest } from "../extensions/folder-upload";
import { uploadFolder, bounded } from "../extensions/upload-transport";

type Project = { id: string; title: string; workspaceRoot: string; deletedAt?: string | null };
type Selection = { name: string; files: {path: string; file: File}[]; totalBytes: number };
const prefix = "/api/cocloud/imports";
const messages: Record<string, string> = {
  sync_conflict: "待上传的目标文件发生变化，请检查后重新选择文件夹。",
  sync_partial: "上次保存未完成，请先检查项目和备份文件。",
  import_unavailable: "上传服务暂不可用，请稍后重试。",
  upload_expired: "上传暂存已过期，请重新选择文件夹。",
  upload_not_found: "上传暂存不存在，请重新选择文件夹。",
  folder_too_large: "本次上传超过 20 GB 限制。",
  invalid_file_count: "文件数量超过 100,000 个上传限制。",
  insufficient_disk_space: "服务器可用空间不足。",
  project_outside_sync_root: "所选项目不在允许上传的目录中。",
  login_required: "请重新登录工作台后重试。",
  forbidden: "当前会话没有上传权限。",
};
const failure = (code: string) => Object.assign(new Error(messages[code] || code), {code});
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(prefix + path, {...init, credentials: "same-origin",
    headers: {"X-Cocloud-Import": "1", ...init.headers}});
  const value = await response.json();
  if (!response.ok) throw failure(value.error || `HTTP ${response.status}`);
  return value;
}
export function selectedFolder(files: File[]): Selection | null {
  if (!files.length) return null;
  const first = files[0]!;
  const name = first.webkitRelativePath.split("/")[0] || "Upload";
  const entries = files.map(file => ({file, path: file.webkitRelativePath
    ? file.webkitRelativePath.slice(name.length + 1) : file.name}));
  const totalBytes = entries.reduce((sum, {file}) => sum + file.size, 0);
  if (entries.length > 100_000) throw Error("文件数量超过 100,000 个上传限制。");
  if (totalBytes > 20 * 1024 ** 3) throw Error("本次上传超过 20 GB 限制。");
  return {name, files: entries, totalBytes};
}
export function WorkbenchFolderUpload() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const active = React.useRef<AbortController | null>(null);
  const project = projects.find(p => p.id === projectId);
  const workflow = useFolderUpload(React, project ? {id: project.id, name: project.title} : null);
  React.useEffect(() => () => active.current?.abort(), []);
  async function loadProjects() {
    try {
      const response = await fetch("/api/projects", {credentials: "same-origin",
        headers: {"x-t3-orchestration-protocol": "2"}, signal: AbortSignal.timeout(15_000)});
      if (!response.ok) throw Error("无法读取项目，请检查登录及文件权限。");
      const value = await response.json();
      setProjects(value.projects.filter((p: Project) => !p.deletedAt && p.workspaceRoot));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "读取项目失败。"); }
  }
  async function start() {
    if (!selection || !project || busy) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("正在检查目标文件…");
    try {
      const manifest = await bounded(signal => readUploadManifest(request, project.id, signal),
        controller.signal, 120_000, () => Error("读取目标目录超时，请重试。"));
      const result = await workflow.upload((options: Parameters<typeof uploadFolder>[0]) => uploadFolder(options, request, failure), {
        name: selection.name, files: selection.files, chunkBytes: 1024 * 1024,
        signal: controller.signal, target: {projectId: project.id, baseVersion: manifest.version},
        onProgress: (p: {files: number; bytes: number; currentPath: string}) => setMessage(
          `${p.files}/${selection.files.length} · ${(p.bytes / 1024 / 1024).toFixed(1)} MB · ${p.currentPath}`),
      }, selection, manifest, request);
      setMessage(result ? "上传完成，可刷新文件列表查看。" : "已取消上传。");
    } catch (cause) {
      setMessage(controller.signal.aborted ? "已取消上传。" : cause instanceof Error ? cause.message : "上传失败，请重试。");
    } finally {active.current = null; setBusy(false);}
  }
  return <details className="my-2 rounded-lg border px-3 py-2 text-xs" onToggle={event => {
    if (event.currentTarget.open && !projects.length) void loadProjects();
  }}>
    <summary className="min-h-9 cursor-pointer content-center">上传文件夹</summary>
    <div className="flex flex-col gap-2">
      <label>目标项目<select aria-label="上传目标项目" disabled={busy} value={projectId}
        onChange={event => setProjectId(event.target.value)} className="block min-h-9 w-full bg-background">
        <option value="">选择当前服务器项目</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select></label>
      <input aria-label="选择文件夹" type="file" multiple disabled={busy || !project}
        ref={node => {node?.setAttribute("webkitdirectory", "");}}
        onChange={event => {
          try {setSelection(selectedFolder(Array.from(event.target.files || []))); workflow.selectFolder(); setMessage("");}
          catch (cause) {setSelection(null); setMessage(cause instanceof Error ? cause.message : "无法读取文件夹。");}
        }}/>
      {workflow.controls({disabled: busy, folder: selection})}
      <button type="button" className="min-h-9 rounded border" disabled={busy || !selection || !project} onClick={() => void start()}>开始上传</button>
      {busy && <button type="button" className="min-h-9 rounded border" onClick={() => active.current?.abort()}>取消上传</button>}
      <p role="status" className="break-words">{message}</p>
    </div>
  </details>;
}
