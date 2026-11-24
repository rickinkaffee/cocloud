import * as Z from 'react';
export function cocloudThreadProgress(rows, latestRun, threadKey) {
  const plan = rows.findLast(row => row.item.type === 'todo_list')?.item;
  if (!plan?.steps?.length || (latestRun?.runId && latestRun.runId !== plan.runId)) return null;
  const prompt = rows.findLast(row => row.item.type === 'user_message');
  if (prompt?.item.runId && prompt.item.runId !== plan.runId) return null;
  return Z.createElement(CocloudProgressRoute, { steps: plan.steps, key: `${threadKey}:${plan.runId}:${plan.planId ?? ''}` });
}

function CocloudProgressRoute({ steps }) {
  const [selected, select] = Z.useState(null);
  const detailId = Z.useId();
  const completed = steps.filter(step => step.status === 'completed').length;
  const current = steps.find(step => step.status === 'running') ?? steps.find(step => step.status !== 'completed');
  const symbols = { completed: '✓', running: '◉', pending: '○' };
  const labels = { completed: '已完成', running: '进行中', pending: '待处理' };
  const element = Z.createElement;
  const active = steps.find(step => step.id === selected);
  return element('details', { className: 'cocloud-thread-progress', open: true, 'aria-label': '任务进度' },
    element('summary', { 'aria-label': `${current?.text ?? '全部完成'}，${completed}/${steps.length}，展开或收起路线` }, `${completed}/${steps.length}`),
    element('ol', { className: 'cocloud-route' }, steps.map((step, index) => element('li', { key: step.id },
      element('button', { type: 'button', 'aria-label': `第${index+1}步，${labels[step.status]}：${step.text}`, 'aria-expanded': step.id === selected, 'aria-controls': detailId, 'data-state': step.status, onClick: () => select(step.id === selected ? null : step.id) },
        element('span', { className: 'cocloud-stop', 'aria-hidden': true }, symbols[step.status]),
        element('span', { className: 'cocloud-stop-label' }, step.text.split(/[：:，,；;。]/u).find(part => part.trim()) || step.text))))),
    element('div', { id: detailId, className: 'cocloud-route-detail', hidden: !active }, active && `${steps.indexOf(active)+1} · ${labels[active.status]}　${active.text}`));
}
