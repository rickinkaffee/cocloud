type Model = { slug: string; name?: string };
const claudeChoices = new Set(['claude-opus-5-5','claude-sonnet-5-5','claude-fable-5-2']);
const families = [['codex','ChatGPT'],['claudeAgent','Claude'],['antigravity','Gemini']];
const myArtChoices = new Set(['MyArt Neon','MyArt Argon','MyArt Hydrogen','MyArt Carbon']);

function activeFamily(props: any) {
  return props.instanceEntries.find((entry: any) => entry.instanceId === props.activeInstanceId)?.driverKind;
}

export function cardRows(props: any, ready: any) {
  return props.instanceEntries.flatMap((entry: any) => {
    if (!entry.enabled || !ready(entry) || (props.lockedProvider && (entry.driverKind !== props.lockedProvider ||
      (props.lockedContinuationGroupKey && entry.continuationGroupKey !== props.lockedContinuationGroupKey)))) return [];
    if (!families.some(([kind]) => kind === entry.driverKind) || (entry.driverKind === 'antigravity' && entry.instanceId !== 'myarthub')) return [];
    return (props.modelOptionsByInstance.get(entry.instanceId) ?? []).filter((model: any) => !model.isUnavailable &&
      (entry.driverKind !== 'claudeAgent' || claudeChoices.has(model.slug)) &&
      (entry.driverKind !== 'antigravity' || myArtChoices.has(model.slug)) &&
      !props.getModelDisabledReason?.(entry.instanceId, model.slug)).map((model: any) => ({entry, model}));
  });
}

export function card(React: any, props: any, ready: any) {
  const h = React.createElement;
  const options = cardRows(props, ready);
  const [browsing,setBrowsing] = React.useState(null);
  const available = (family: string) => options.some((row: any) => row.entry.driverKind === family);
  const family = available(browsing) ? browsing : activeFamily(props);
  const rows = options.filter((row: any) => row.entry.driverKind === family);
  return h('section', {className:'cocloud-choice-card'}, h('strong', {}, '选择模型'),
    h('div', {className:'cocloud-family-options',role:'group','aria-label':'模型系列'}, ...families.map(([kind,label]) =>
      h('button',{key:kind,type:'button','aria-pressed':kind===family,disabled:props.disabled||!available(kind),onClick:()=>setBrowsing(kind)},label))),
    h('div', {className:'cocloud-choice-list'}, rows.length ? rows.map(({entry,model}: any) => {
      const selected = entry.instanceId === props.activeInstanceId && model.slug === props.model;
      return h('button', {type:'button', key:JSON.stringify([entry.instanceId,model.slug]), 'aria-pressed':selected,
        disabled:props.disabled, onClick:()=>props.onInstanceModelChange(entry.instanceId,model.slug)},
        h('span', {}, model.name || model.slug, h('small', {}, model.description || entry.displayName)),
        selected ? h('span', {'aria-hidden':true}, '✓') : null);
    }) : h('small', {}, '当前没有可选的已启用模型')));
}

export function effortSlider(React: any, children: any) {
  const h = React.createElement;
  const ref = React.useRef(null);
  const [state, setState] = React.useState({labels:[], index:-1});
  const buttons = () => Array.from(ref.current?.querySelectorAll('button[data-effort-level]:not(:disabled)') ?? []) as HTMLButtonElement[];
  React.useLayoutEffect(() => {
    const sync = () => {
      const options = buttons();
      const next = {labels:options.map(button => (button.firstElementChild?.textContent || button.textContent || '').trim()),
        index:options.findIndex(button => button.getAttribute('aria-checked') === 'true')};
      setState((previous: any) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    sync();const observer = new MutationObserver(sync);
    observer.observe(ref.current,{subtree:true,childList:true,attributes:true,characterData:true});return () => observer.disconnect();
  }, []);
  const usable = state.labels.length > 1 && state.index >= 0;
  return h('div', {'data-model-picker-effort':true,className:'cocloud-effort-card'},
    usable && h('label', {}, h('span', {}, '思考强度', h('output', {}, state.labels[state.index])),
      h('input', {type:'range',min:0,max:state.labels.length-1,step:1,value:state.index,'aria-label':'思考强度','aria-valuetext':state.labels[state.index],
        onKeyDown:(event: any)=>event.stopPropagation(),onChange:(event: any)=>buttons()[Number(event.target.value)]?.click()}),
      h('span',{className:'cocloud-effort-ticks','aria-hidden':true},state.labels.map((text: string,index: number)=>h('small',{key:index},text)))),
    h('div', {ref,className:usable?'cocloud-effort-source is-slider':'cocloud-effort-source'},children));
}

export function shortLabel(label: string): string {
  return label.replace(/^GPT[- ]/i, '').replace(/^gpt-/i, '').replace(/-(sol|astra|luna)\b/gi, ' $1');
}

export function mergeModels(custom: Array<string | Model>, fetched: Model[]) {
  const seen = new Set(custom.map(entry => typeof entry === 'string' ? entry : entry.slug));
  const additions = fetched.filter(entry => !seen.has(entry.slug) && !!seen.add(entry.slug));
  return { models: [...custom, ...additions], added: additions.length };
}

/** The host owns authentication, permissions, settings persistence and config subscriptions. */
export function createLoader(React: any, useHost: any) {
  const h = React.createElement;
  return function LoadModels({ environmentId, instanceId, driverKind }: any) {
    const host = useHost(environmentId);
    const [state, setState] = React.useState({ busy: false, message: '', error: false });
    const pending = React.useRef(false);
    const mounted = React.useRef(true);
    const controller = React.useRef(null);
    const root = React.useRef(null);
    const target = React.useRef('');
    target.current = environmentId + ':' + instanceId;
    React.useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; controller.current?.abort(); };
    }, []);
    if (!environmentId || driverKind !== 'codex') return null;
    async function load() {
      if (pending.current || !host.canWrite) return;
      pending.current = true;
      const selected = environmentId + ':' + instanceId;
      const isCurrent = () => mounted.current && target.current === selected;
      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(() => abort.abort(), 30_000);
      setState({ busy: true, message: '', error: false });
      try {
        const response = await fetch('/api/cocloud/balance?' + new URLSearchParams({ resource: 'models', instanceId }), {
          credentials: 'same-origin', signal: abort.signal,
        });
        const body = await response.json();
        if (!response.ok) throw Error(response.status === 401 ? '请先登录工作台' : response.status === 403 ? '当前连接没有加载模型的权限' : '加载失败，请稍后重试');
        if (!isCurrent()) return;
        if (body.environmentId !== environmentId || body.instanceId !== instanceId)
          throw Error('请在此服务器的工作台中加载模型');
        if (!Array.isArray(body.models) || !body.models.length || body.models.some((m: any) => typeof m.slug !== 'string' || !m.slug.trim()))
          throw Error('供应商没有返回可用的聊天模型');
        // Read after the network request: preserve edits made while discovery was in flight.
        const config = host.getConfig();
        const instance = config?.settings?.providerInstances?.[instanceId];
        if (!instance || instance.driver !== 'codex') throw Error('供应商配置已改变，请重新打开后重试');
        const merged = mergeModels(instance.config?.customModels ?? [], body.models);
        if (merged.added) {
          const saved = await host.save({ patch: {}, providerInstanceMutation: {
            operation: 'upsert', instanceId,
            instance: { ...instance, config: { ...instance.config, customModels: merged.models } },
          }});
          if (saved?._tag === 'Failure') throw Error('模型未保存，请检查连接权限后重试');
        }
        const refreshed = await host.refresh(instanceId);
        if (refreshed?._tag === 'Failure') throw Error('模型已保存，请重新打开列表查看');
        if (isCurrent()) {
          setState({ busy: false, message: `已加载 ${body.models.length} 个模型${merged.added ? `，新增 ${merged.added} 个` : ''}`, error: false });
          // Favorites can hide newly discovered models. Open this provider's existing tab.
          const popup = root.current?.closest('.cocloud-model-popup');
          const providerTab = [...(popup?.querySelectorAll('[data-model-picker-provider]') ?? [])]
            .find((node: any) => node.getAttribute('data-model-picker-provider') === instanceId);
          providerTab?.querySelector('button')?.click();
        }
      } catch (error: any) {
        if (isCurrent()) setState({ busy: false, message: error.name === 'AbortError' ? '加载超时，点击重试' : error.message || '加载失败，请重试', error: true });
      } finally {
        clearTimeout(timeout);
        pending.current = false;
        if (controller.current === abort) controller.current = null;
      }
    }
    return h('div', { ref: root, className: 'cocloud-model-loader' },
      h('button', { type: 'button', disabled: state.busy || !host.canWrite, onClick: load,
        'aria-busy': state.busy, className: 'cocloud-load-models' },
        h('span', { 'aria-hidden': true }, '↻'), state.busy ? '加载中…' : '加载模型列表'),
      h('span', { role: 'status', 'aria-live': 'polite', className: state.error ? 'cocloud-model-message is-error' : 'cocloud-model-message' }, state.message),
      !host.canWrite ? h('span', { className: 'cocloud-model-message' }, '当前连接只可查看') : null,
    );
  };
}
