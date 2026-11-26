type Options = {name: string; files: {path: string; file: Blob & {lastModified?: number}}[];
  chunkBytes: number; signal: AbortSignal; onProgress: (value: any) => void;
  directories?: string[]; target?: any; destination?: any};

// Bound local File reads as well as HTTP calls. Abort alone is insufficient for
// unreadable files and transports that never settle their returned promise.
export async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal,
  milliseconds: number, failure: () => Error): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  let timer: any, abort: () => void;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => {controller.abort(parent.reason); reject(parent.reason);};
    parent.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => {const error = failure(); controller.abort(error); reject(error);}, milliseconds);
  });
  try {return await Promise.race([Promise.resolve().then(() => run(controller.signal)), deadline]);}
  finally {clearTimeout(timer); parent.removeEventListener('abort', abort!);}
}

export async function uploadFolder(options: Options, request: any, error: (code: string) => Error,
  timing = {read: 15000, chunk: 45000, status: 15000, prepare: 120000, commit: 300000, retryDelay: 1000}) {
  const {name, files, signal, onProgress, directories = [], target, destination} = options;
  // Smaller chunks update visible progress instead of waiting for an entire 8 MiB.
  const chunkBytes = Math.min(options.chunkBytes, 1024 * 1024);
  const call = (path: string, init: any, timeout: number, message: string, parent = signal) =>
    bounded(child => request(path, {...init, signal: child}), parent, timeout, () => error(message));
  const session: any = await call('', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name, directories, ...target, ...(destination ? {destination} : {}),
      files: files.map(({file, path}) => ({path, size: file.size, lastModified: file.lastModified}))})},
    timing.prepare, '准备上传超时，请重试。');
  let completed = 0, bytes = 0, next = 0;
  const recovered = files.map(({file}, index) => {
    const offset = session.offsets?.[index] ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw error('上传断点无效，请重新选择文件夹。');
    const done = offset === file.size && (file.size > 0 || session.exists?.[index]);
    bytes += offset; if (done) completed++;
    return {offset, done};
  });
  onProgress({files: completed, bytes, currentPath: session.resumed ? '已恢复上传进度，继续传输剩余文件…' : '开始上传…'});
  const workers = new AbortController();
  const transfer = AbortSignal.any([signal, workers.signal]);
  try {
    await Promise.all(Array.from({length: Math.min(3, files.length)}, async () => {
      for (;;) {
        const index = next++, entry = files[index];
        if (!entry) return;
        const {file, path} = entry;
        if (recovered[index].done) continue;
        let offset = recovered[index].offset, emptySent = false;
        // Show the file currently being read, not the last successful file.
        onProgress({files: completed, bytes, currentPath: path});
        while (offset < file.size || file.size === 0 && !emptySent) {
          transfer.throwIfAborted();
          const end = Math.min(file.size, offset + chunkBytes);
          let body: ArrayBuffer;
          try {
            body = await bounded(() => file.slice(offset, end).arrayBuffer(), transfer, timing.read,
              () => error(`读取本地文件超时：${path}。请确认文件可访问后重试。`));
          } catch (cause) {
            transfer.throwIfAborted();
            throw error(`无法读取本地文件：${path}。请确认文件可访问后重试。`);
          }
          if (body.byteLength !== end - offset) throw error(`本地文件读取不完整：${path}。请重新选择文件夹。`);
          let success = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const response: any = await call(`/${session.id}/files/${index}?offset=${offset}`,
                {method: 'PUT', body, headers: {'Content-Type': 'application/octet-stream'}},
                timing.chunk, `上传请求超时：${path}`, transfer);
              if (response.offset !== end) throw error('incomplete_chunk');
              success = true; break;
            } catch (cause) {
              transfer.throwIfAborted();
              const code = (cause as any)?.code;
              if (code && !['offset_mismatch', 'import_unavailable', 'incomplete_chunk'].includes(code) && !code.startsWith('上传请求超时')) throw cause;
              const delay = (timing as any).retryDelay ?? 1000;
              await bounded(() => new Promise<void>(resolve => setTimeout(resolve, delay * Math.min(2 ** attempt, 8))),
                transfer, delay * Math.min(2 ** attempt, 8) + 1000, () => error(`等待重试超时：${path}`));
              // A lost response must not resend bytes already accepted by the server.
              try {
                const state: any = await call(`/${session.id}/files/${index}`, {}, timing.status,
                  `查询上传进度超时：${path}`, transfer);
                if (state.offset === end && (end > 0 || state.exists)) {success = true; break;}
                if (state.offset !== offset) throw error(`上传进度不一致：${path}。请重新选择文件夹。`);
              } catch (statusError) {
                transfer.throwIfAborted();
                if ((statusError as any)?.code?.startsWith('上传进度不一致')) throw statusError;
              }
              onProgress({files: completed, bytes, currentPath: `${path}（连接中断，重试 ${attempt + 1}/5）`});
            }
          }
          if (!success) throw error(`上传失败：${path}。连接超时或中断；已保留上传进度，重新选择同一文件夹可继续。`);
          bytes += end - offset; offset = end; emptySent = true;
          onProgress({files: completed, bytes, currentPath: path});
        }
        completed++;
        onProgress({files: completed, bytes, currentPath: path});
      }
    }).map(task => task.catch(cause => {workers.abort(cause); throw cause;})));
    signal.throwIfAborted();
    onProgress({files: completed, bytes, currentPath: '文件传输完成，正在合并并保存到项目…', phase: 'committing'});
    for (let attempt = 0; ; attempt++) {
      try {return await call(`/${session.id}/commit`, {method: 'POST'}, timing.commit, '保存到项目超时，请检查服务端进度后重试。');}
      catch (cause) {signal.throwIfAborted(); if (attempt >= 2 || (cause as any)?.code) throw cause;}
    }
  } catch (cause) {
    workers.abort(cause);
    // Preserve staging on transient failures; explicit user cancellation still deletes it.
    if (signal.aborted) await bounded(child => request(`/${session.id}`, {method: 'DELETE', signal: child}),
      new AbortController().signal, 10000, () => error('取消上传超时')).catch(() => {});
    throw cause;
  }
}
