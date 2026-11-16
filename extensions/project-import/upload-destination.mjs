// Folders merge; conflict policy applies to individual files, like Explorer paste.
export function placeUpload(manifest, current, options, fail) {
  if (!options) return manifest;
  if (!['folder', 'root'].includes(options.placement) ||
      !['skip', 'keep', 'overwrite'].includes(options.conflict)) fail(400, 'invalid_upload_destination');
  let result = manifest;
  if (options.placement === 'folder') {
    const folder = options.folderName;
    if (!folder || folder.includes('/') || !/^[^\\\x00-\x1f\x7f]+$/.test(folder) ||
        ['.', '..', '.cocloud-imports'].includes(folder) || Buffer.byteLength(folder) > 180)
      fail(400, 'invalid_folder_name');
    result = {...manifest,
      files: manifest.files.map(file => ({...file, path: `${folder}/${file.path}`})),
      directories: [folder, ...manifest.directories.map(path => `${folder}/${path}`)]};
  }
  if (options.fileConflicts !== undefined && (options.fileConflicts === null ||
      Array.isArray(options.fileConflicts) || typeof options.fileConflicts !== 'object' ||
      Object.values(options.fileConflicts).some(choice => !['skip', 'keep', 'overwrite'].includes(choice))))
    fail(400, 'invalid_upload_destination');
  const existingFiles = new Set([...current.files.map(file => file.path), ...(current.skipped ?? [])]);
  const occupied = new Set([...existingFiles, ...current.directories,
    ...result.files.map(file => file.path), ...result.directories]);
  const files = result.files.filter(file => {
    const choice = Object.hasOwn(options.fileConflicts ?? {}, file.path) ? options.fileConflicts[file.path] : options.conflict;
    return !existingFiles.has(file.path) || choice !== 'skip';
  }).map(file => {
    if (!existingFiles.has(file.path) ||
        (Object.hasOwn(options.fileConflicts ?? {}, file.path)
          ? options.fileConflicts[file.path] : options.conflict) === 'overwrite') return file;
    const slash = file.path.lastIndexOf('/');
    const parent = file.path.slice(0, slash + 1);
    const filename = file.path.slice(slash + 1);
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    for (let suffix = 2; ; suffix++) {
      const name = `${stem} (${suffix})${extension}`;
      if (Buffer.byteLength(name) > 255) fail(400, 'invalid_file_path');
      const path = parent + name;
      if (occupied.has(path)) continue;
      occupied.add(path);
      return {...file, path};
    }
  });
  return {...result, files};
}
