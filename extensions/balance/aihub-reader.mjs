import { readFile } from 'node:fs/promises';

const amount = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;

export function createAihubReader({ id = 'aihub', credentialPath = id === 'sydney' ? process.env.SYDNEY_KEY_FILE : process.env.AIHUB_CREDENTIAL_FILE, fetcher = fetch, now = Date.now } = {}) {
  return async () => {
    const secret = await readFile(credentialPath, 'utf8');
    const token = id === 'sydney' ? secret.trim() : JSON.parse(secret).token;
    if (typeof token !== 'string' || !token) throw Error('Missing credential');
    const date = new Date(now() + 28800000).toISOString().slice(0, 10);
    if (id === 'sydney') {
      const read = async (resource, field) => {
        const response = await fetcher(new URL('https://api.sydney-ai.com/v1/dashboard/billing/' + resource), {headers:{Authorization:`Bearer ${token}`}, redirect:'error', signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('Sydney billing unavailable');
        const value = amount((await response.json())[field]);
        if (value === null) throw Error('Invalid Sydney billing data');
        return value;
      };
      const [limit, cents] = await Promise.all([read('subscription','hard_limit_usd'),read('usage','total_usage')]);
      if (limit === 1e8) throw Error('Unlimited quota');
      return {checkedAt:now(),accounts:[{id,ok:true,isValid:true,remaining:limit-cents/100}],daily:{date,[id]:{ok:false,cost:null}}};
    }
    const url = new URL('/v1/usage', process.env.AIHUB_BASE_URL);
    if (url.protocol !== 'https:') throw Error('HTTPS billing origin required');
    url.search = new URLSearchParams({ start_date: date, end_date: date, timezone: 'Asia/Shanghai', days: '1' });
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('AIHub unavailable');
    const body = await response.json();
    const remaining = amount(body.remaining);
    if (remaining === null) throw Error('Invalid balance');
    const cost = amount(body.usage?.today?.actual_cost);
    return {
      checkedAt: now(),
      accounts: [{ id, ok: true, remaining, isValid: body.isValid !== false }],
      daily: { date, [id]: { ok: cost !== null, cost, models: (Array.isArray(body.model_stats) ? body.model_stats : []).filter(row => typeof row.model === 'string' && amount(row.actual_cost ?? row.cost) !== null).map(row => ({ model: row.model, cost: amount(row.actual_cost ?? row.cost) })) } },
    };
  };
}
