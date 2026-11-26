// Destination inventory is for collision checks, not the payload being transferred.
export function readUploadManifest(request: any, projectId: string, signal: AbortSignal) {
  return request(`/sync/${encodeURIComponent(projectId)}/manifest?purpose=upload`, {signal});
}

type Entry = {path: string};
type Manifest = {files: Entry[]; directories: string[]; skipped?: string[]};
type Placement = 'folder' | 'root';
type Choice = 'skip' | 'overwrite' | 'keep' | null;
type Answer = {choice: Choice; all: boolean};

export function conflictingEntries(manifest: Manifest, folder: any, files: Entry[], placement: Placement) {
  const existing = new Set([...manifest.files.map(file => file.path), ...(manifest.skipped ?? [])]);
  return files.map(file => placement === 'folder' ? `${folder.name}/${file.path}` : file.path)
    .filter(path => existing.has(path));
}

// Uses the application's React instance and existing authenticated upload transport.
export function useFolderUpload(React: any, target: any) {
  const h = React.createElement;
  const [placement, setPlacement] = React.useState('folder' as Placement);
  const [isFolder, setIsFolder] = React.useState(true);
  const [prompt, setPrompt] = React.useState(null as null | {names: string[]; finish: (choice: Choice, all?: boolean) => void});
  const [skipped, setSkipped] = React.useState(0);
  const [applyAll, setApplyAll] = React.useState(false);
  const pending = React.useRef(null as null | (() => void));
  React.useEffect(() => () => pending.current?.(), []);
  function choose(names: string[], signal: AbortSignal): Promise<Answer> {
    signal.throwIfAborted();
    return new Promise(resolve => {
      let settled = false;
      const finish = (choice: Choice, all = false) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        pending.current = null;
        setPrompt(null);
        resolve({choice, all});
      };
      const cancel = () => finish(null);
      pending.current = cancel;
      signal.addEventListener('abort', cancel, {once: true});
      setPrompt({names, finish});
    });
  }
  const effective: Placement = target ? placement : 'folder';
  return {
    selectFiles() {setIsFolder(false); setPlacement('root');},
    selectFolder() {setIsFolder(true); setPlacement('folder');},
    path(folder: any) {return target ? `${target.name}${effective === 'folder' ? '/' + folder.name : ''}` : null;},
    description: '同名文件夹自动合并；同名文件可选择跳过、覆盖或保留。保留时自动重命名上传文件，原文件不变。',
    controls({disabled, folder}: any) {
      if (!folder) return null;
      return h(React.Fragment, null,
        target && isFolder ? h('fieldset', {disabled, className: 'space-y-2 rounded-lg border p-3 text-sm'},
          h('legend', {className: 'px-1 font-medium'}, '上传位置'),
          ...([['folder', '新建文件夹', `在当前项目下创建 ${folder.name}/，同名文件夹自动合并。`],
            ['root', '直接传到根目录', '将所选文件夹内的内容直接放到当前项目根目录。']] as const).map(([value, label, hint]) =>
            h('label', {key: value, className: 'flex min-h-11 cursor-pointer items-start gap-2 py-1'},
              h('input', {type: 'radio', name: 'folder-upload-placement', value,
                checked: placement === value, onChange: () => setPlacement(value), className: 'mt-1'}),
              h('span', null, h('span', {className: 'block font-medium'}, label),
                h('span', {className: 'text-xs text-muted-foreground'}, hint))))) : null,
        skipped ? h('p', {role: 'status', className: 'text-xs text-muted-foreground'}, `本次跳过 ${skipped} 个同名文件，仅上传其余文件。`) : null,
        prompt ? h('section', {role: 'alertdialog', 'aria-label': '同名文件',
          className: 'space-y-3 rounded-lg border border-primary bg-background p-3 text-sm'},
          h('p', {className: 'font-medium'}, '目标位置已有同名文件'),
          h('p', {className: 'max-h-24 overflow-auto break-all text-xs'}, prompt.names[0]),
          h('p', {className: 'text-xs text-muted-foreground'},
            '文件夹会自动合并。跳过：保留服务器文件，不上传该文件。覆盖：替换同名文件。保留：上传文件自动添加编号。'),
          prompt.names.length > 1 ? h('label', {className: 'flex min-h-11 items-center gap-2'},
            h('input', {type: 'checkbox', checked: applyAll, onChange: (event: any) => setApplyAll(event.target.checked)}),
            `对剩余 ${prompt.names.length} 个同名文件应用相同选择`) : null,
          h('div', {className: 'flex flex-wrap gap-2'},
            ...([['skip', '跳过'], ['overwrite', '覆盖'], ['keep', '保留'], [null, '取消上传']] as const).map(([value, label]) =>
              h('button', {key: label, type: 'button', autoFocus: value === 'keep',
                className: 'min-h-11 rounded-md border px-4 py-2', onClick: () => prompt.finish(value, applyAll)}, label)))) : null);
    },
    async upload(transport: any, args: any, folder: any, manifest: Manifest | null, request: any) {
      let names: string[], version: string | undefined;
      if (target && manifest) names = conflictingEntries(manifest, folder, args.files, effective);
      else {
        const status = await request(`/destination?name=${encodeURIComponent(folder.name)}`, {signal: args.signal});
        names = status.exists ? conflictingEntries(status, folder, args.files, 'root') : [];
        version = status.version;
      }
      const decisions: Record<string, Exclude<Choice, null>> = {};
      for (let index = 0; index < names.length; index++) {
        const {choice, all} = await choose(names.slice(index), args.signal);
        if (!choice) return null;
        decisions[names[index]] = choice;
        if (all) {
          for (const name of names.slice(index + 1)) decisions[name] = choice;
          break;
        }
      }
      args.signal.throwIfAborted();
      const filtered = args.files.filter((file: Entry) => {
        const path = target && effective === 'folder' ? `${folder.name}/${file.path}` : file.path;
        return decisions[path] !== 'skip';
      });
      setSkipped(args.files.length - filtered.length);
      return transport({...args, files: filtered, destination: {placement: effective, conflict: 'keep', fileConflicts: decisions,
        folderName: folder.name, ...(version ? {baseVersion: version} : {})}});
    },
  };
}
