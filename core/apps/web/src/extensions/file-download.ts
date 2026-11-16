// Attachments already have a scoped URL and Content-Disposition from the host.
// Let the browser stream them to disk instead of buffering the entire response
// in fetch().blob(), which loses the download on body/network failure.
export async function saveAttachment(url: string, name: string, fallback: any) {
  const target = new URL(url, window.location.href);
  if (navigator.userAgent.includes('CocloudAndroid/') ||
      target.origin !== window.location.origin ||
      !/^https?:$/.test(target.protocol) || !target.pathname.startsWith('/api/assets/')) {
    return fallback(url, name);
  }
  const link = document.createElement('a');
  link.href = target.href;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
}

// The factory uses the pinned host's React, path parser and authenticated download
// hook. Keep the original memoized chip intact (including its compiler caches).
export function withFileDownload(React: any, Original: any, useMediaActions: any, splitPath: any) {
  const h = React.createElement;
  function Download({environmentId, threadId, path}: any) {
    const name = path.split(/[\\/]/).pop() || 'download';
    const {save, canReadMedia} = useMediaActions({
      kind: 'image', // Host hook's save is format-agnostic; no image decoding occurs.
      name, src: null,
      asset: {environmentId, resource: {_tag: 'media-file', threadId, path, disposition: 'attachment'}},
    });
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const pending = React.useRef(false);
    const download = async (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (pending.current || !canReadMedia) return;
      pending.current = true;
      setBusy(true);
      setMessage('正在准备下载…');
      try {
        await save();
        setMessage('已发起下载');
      } catch (error) {
        setMessage('下载失败：' + (error instanceof Error ? error.message : '请重试'));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    };
    return h('span', {className: 'cocloud-file-download', 'data-markdown-copy': ''},
      h('button', {
        type: 'button', onClick: download, disabled: busy || !canReadMedia,
        'aria-label': '下载 ' + name,
        title: canReadMedia ? '下载 ' + name : '当前连接没有文件读取权限或尚未就绪',
        style: {minHeight: 44, minWidth: 44, padding: '0 8px', cursor: 'pointer',
          color: 'inherit', textDecoration: 'underline', opacity: busy || !canReadMedia ? 0.5 : 1},
      }, busy ? '下载中…' : '下载'),
      message ? h('span', {role: 'status', style: {fontSize: '0.85em', overflowWrap: 'anywhere'}}, message) : null);
  }
  return React.memo(function FileLinkWithDownload(props: any) {
    const thread = props.threadRef;
    const environmentId = props.environmentId ?? thread?.environmentId;
    const path = splitPath(props.targetPath).path;
    const available = environmentId && thread?.threadId && path && !/[\\/]$/.test(path)
      && (!thread.environmentId || thread.environmentId === environmentId);
    return h(React.Fragment, null, h(Original, props), available
      ? h(Download, {key: environmentId + ':' + thread.threadId + ':' + path,
          environmentId, threadId: thread.threadId, path}) : null);
  });
}
