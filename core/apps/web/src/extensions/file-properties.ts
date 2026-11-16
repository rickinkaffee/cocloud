// File tree actions share the authenticated project sync boundary.
export function items() {
  return [{id: 'cocloud-download', label: '下载'}, {id: 'cocloud-properties', label: '属性'}];
}
export function formatSize(bytes: number) {
  const units = ['字节', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes, unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return unit ? `${n.toLocaleString('zh-CN', {maximumFractionDigits: 2})} ${units[unit]}（${bytes.toLocaleString('zh-CN')} 字节）` : `${bytes} 字节`;
}
async function request(url: string) {
  const response = await fetch(url, {credentials: 'same-origin', headers: {'x-t3-orchestration-protocol': '2'}});
  const value = await response.json();
  if (!response.ok) throw Error(value.error === 'file_not_found' ? '文件已不存在，请刷新文件列表。' : `无法读取文件（${value.error || response.status}）`);
  return value;
}
export async function resolveEntry(cwd: string, relative: string) {
  const full = /^(\/|[A-Za-z]:|\\)/.test(relative) ? relative : cwd.replace(/\/$/, '') + '/' + relative;
  const {projects} = await request('/api/projects');
  const project = projects.filter((p: any) => !p.deletedAt && p.workspaceRoot && full.startsWith(p.workspaceRoot.replace(/\/$/, '') + '/'))
    .sort((a: any, b: any) => b.workspaceRoot.length - a.workspaceRoot.length)[0];
  if (!project) throw Error('当前路径不属于此服务器的项目，无法读取属性或下载。');
  const path = full.slice(project.workspaceRoot.replace(/\/$/, '').length + 1);
  return `/api/cocloud/imports/sync/${encodeURIComponent(project.id)}/ACTION?path=${encodeURIComponent(path)}`;
}
export async function act(action: string, cwd: string, path: string, androidDownload: any) {
  if (action === 'cocloud-properties') return showProperties(() => resolveEntry(cwd, path).then(url => request(url.replace('/ACTION?', '/properties?'))));
  const url = (await resolveEntry(cwd, path)).replace('/ACTION?', '/download?');
  // Preflight surfaces missing files and authorization failures before dispatch.
  await request(url.replace('/download?', '/properties?'));
  if (androidDownload(url)) return;
  const link = document.createElement('a'); link.href = url;
  link.download = path.split('/').pop() || 'download'; link.hidden = true;
  document.body.append(link); try { link.click(); } finally { link.remove(); }
}
export function showProperties(load: () => Promise<any>) {
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'cocloud-file-properties';
  dialog.setAttribute('aria-label', '属性');
  const title = document.createElement('h2'); title.textContent = '属性';
  const body = document.createElement('div'); body.setAttribute('role', 'status'); body.textContent = '正在读取属性…';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '确定';
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); }, {once: true});
  dialog.append(title, body, close); document.body.append(dialog); dialog.showModal(); close.focus();
  return load().then(info => {
    if (!dialog.isConnected) return;
    title.textContent = info.name + ' 属性'; body.removeAttribute('role'); body.replaceChildren();
    const type = info.kind === 'directory' ? '文件夹' : (info.name.includes('.') ? info.name.split('.').pop().toUpperCase() + ' 文件' : '文件');
    const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', {hour12: false, timeZoneName: 'short'}) : '不可用';
    const rows = [['名称', info.name], ['类型', type], ['位置', info.location], ['完整路径', info.path], ['大小', formatSize(info.size)],
      ...(info.kind === 'directory' ? [['包含', `${info.files} 个文件，${info.directories} 个文件夹`], ...(info.skipped ? [['未计入大小', `${info.skipped} 个链接或特殊文件`]] : [])] : []),
      ['修改时间', date(info.modifiedAt)], ['创建时间', date(info.createdAt)], ['访问时间', date(info.accessedAt)], ['权限', info.mode]];
    const list = document.createElement('dl');
    for (const [label, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value; list.append(dt, dd);
    }
    body.append(list);
  }).catch(error => { if (dialog.isConnected) { body.setAttribute('role', 'alert'); body.textContent = error.message || '读取属性失败，请重试。'; } });
}
