import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import { createAihubReader } from './aihub-reader.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export async function readProviderModels(instanceId) {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(instanceId)) throw Error('Invalid instance');
  const { stdout } = await execFileAsync('python3', [NodeURL.fileURLToPath(new URL('./provider-models.py', import.meta.url)), instanceId], {
    timeout: 27_000, maxBuffer: 1_000_000,
  });
  return JSON.parse(stdout);
}

const validAccounts = ["aihub", "sydney"];
export function combinedReader(readers = validAccounts.map(id => createAihubReader({ id }))) {
  return async force => {
    const results = (await Promise.allSettled(readers.map(read => read(force)))).filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!results.length) throw Error('Balance unavailable');
    return {checkedAt: Date.now(), accounts: results.flatMap(value => value.accounts), daily: Object.assign({}, ...results.map(value => value.daily))};
  };
}
const validModels = ["gpt-6.1-sol", "gpt-6-astra"];
const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

// Only billing fields cross the bridge; DSH errors and credentials stay on the server.
export function sanitizeBalance(value) {
  if (!value || !Array.isArray(value.accounts) || !value.daily) throw new Error("Invalid upstream");
  const amount = (source, key) => ({
    ok: source?.ok === true && number(source[key]) !== null,
    cost: number(source?.[key]),
  });
  return {
    checkedAt: number(value.checkedAt) ?? Date.now(),
    accounts: validAccounts.map((id) => {
      const source = value.accounts.find((account) => account.id === id);
      return {
        id,
        ok: source?.ok === true && number(source.remaining) !== null,
        remaining: number(source?.remaining),
        isValid: source?.isValid === true,
      };
    }),
    daily: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(value.daily.date) ? value.daily.date : "",
      official: amount(value.daily.official, "modelCost"),
      search: amount(value.daily.official, "searchCost"),
      sydney: amount(value.daily.sydney, "cost"),
      aihub: {
        ...amount(value.daily.aihub, "cost"),
        models: (Array.isArray(value.daily.aihub?.models) ? value.daily.aihub.models : [])
          .filter((model) => validModels.includes(model.model) && number(model.cost) !== null)
          .map((model) => ({ model: model.model, cost: number(model.cost) })),
      },
    },
  };
}

export function createBalanceServer({ authenticate, readBalance, readModels = readProviderModels, now = Date.now }) {
  let cached;
  let pending;
  let lastRead = -Infinity;
  async function read(force) {
    if (pending) return pending;
    if (cached && now() - lastRead < (force ? 5_000 : 60_000)) return cached;
    pending = readBalance(force)
      .then((value) => {
        cached = sanitizeBalance(value);
        lastRead = now();
        return cached;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  return NodeHttp.createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(value));
    };
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/cocloud/balance") return reply(404, { error: "not_found" });
    if (request.method !== "GET") return reply(405, { error: "method_not_allowed" });
    try {
      const auth = await authenticate(request.headers);
      if (auth.cookies?.length) response.setHeader("Set-Cookie", auth.cookies);
      if (!auth.authenticated) return reply(401, { error: "authentication_required" });
      if (url.searchParams.get('resource') === 'models') {
        if (!(auth.permissions ?? auth.scopes ?? []).includes('orchestration:read'))
          return reply(403, { error: 'scope_required' });
        try {
          return reply(200, await readModels(url.searchParams.get('instanceId') || 'codex'));
        } catch {
          return reply(503, { error: 'model_catalog_unavailable' });
        }
      }
      if (!(auth.permissions ?? auth.scopes ?? []).includes("diagnostics:read"))
        return reply(403, { error: "scope_required" });
      return reply(200, await read(url.searchParams.get("refresh") === "1"));
    } catch {
      return reply(503, { error: "balance_unavailable" });
    }
  });
}

export function createDshReader({
  base = "http://127.0.0.1:3080",
  cookiePath = process.env.DSH_COOKIE_FILE,
  logPath = process.env.DSH_LOG_FILE,
} = {}) {
  let cookie;
  async function getCookie() {
    if (cookie) return cookie;
    try {
      cookie = (await NodeFSP.readFile(cookiePath, "utf8")).trim();
    } catch {}
    if (cookie) return cookie;
    // DSH publishes its process launch URL; exchange it only over loopback and retain a private cookie.
    const file = await NodeFSP.open(logPath, "r");
    let tail;
    try {
      const { size } = await file.stat();
      const buffer = Buffer.alloc(Math.min(size, 1_048_576));
      await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      tail = buffer.toString("utf8");
    } finally {
      await file.close();
    }
    const urls = tail.match(/https?:\/\/[^\s\x1b<>"']+/g) ?? [];
    const launch = urls.reverse().find((url) => {
      try {
        const parsed = new URL(url);
        return (
          ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
          parsed.port === "3080" &&
          parsed.searchParams.has("token")
        );
      } catch {
        return false;
      }
    });
    if (!launch) throw new Error("DSH authentication unavailable");
    const launchUrl = new URL(launch);
    const response = await fetch(
      `${base}/?token=${encodeURIComponent(launchUrl.searchParams.get("token"))}`,
      { redirect: "manual", signal: AbortSignal.timeout(5_000) },
    );
    cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    if (!cookie || response.status !== 303) {
      cookie = undefined;
      throw new Error("DSH authentication unavailable");
    }
    await NodeFSP.writeFile(cookiePath, cookie, { mode: 0o600 });
    return cookie;
  }
  return async (force) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${base}/api/aihub-balance/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await getCookie() },
        body: JSON.stringify({
          type: "client-request",
          method: "aihub-balance/read",
          rpcId: NodeCrypto.randomUUID(),
          payload: {
            refresh: force,
            client: { version: "cocloud-1", locale: "zh", timezoneOffsetSeconds: 28800 },
          },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (response.status === 401 && attempt === 0) {
        cookie = undefined;
        await NodeFSP.writeFile(cookiePath, "", { mode: 0o600 });
        continue;
      }
      if (!response.ok) throw new Error("DSH balance unavailable");
      const body = await response.json();
      if (body.result?.ok !== true) throw new Error("DSH balance unavailable");
      return body.result.value;
    }
    throw new Error("DSH balance unavailable");
  };
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  const server = createBalanceServer({
    authenticate: async (headers) => {
      if (!headers.cookie && !headers.authorization) return { authenticated: false };
      const forwarded = { "x-t3-orchestration-protocol": "2" };
      if (headers.cookie) forwarded.Cookie = headers.cookie;
      if (headers.authorization) forwarded.Authorization = headers.authorization;
      const response = await fetch("http://127.0.0.1:3773/api/auth/session", {
        headers: forwarded,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Session check unavailable");
      return { ...(await response.json()), cookies: response.headers.getSetCookie() };
    },
    readBalance: combinedReader(),
  });
  server.listen(3774, "127.0.0.1");
  const stop = () => {
    server.close();
    server.closeIdleConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
