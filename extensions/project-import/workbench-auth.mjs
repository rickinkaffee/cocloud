export async function authenticateWorkbench(headers) {
  if (!headers.cookie && !headers.authorization) return { authenticated: false };
  const forwarded = { "x-t3-orchestration-protocol": "2" };
  if (headers.cookie) forwarded.Cookie = headers.cookie;
  if (headers.authorization) forwarded.Authorization = headers.authorization;
  const response = await fetch(new URL("/api/auth/session", process.env.WORKBENCH_INTERNAL_URL || "http://127.0.0.1:3773"), {
    headers: forwarded,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Session check unavailable");
  return { ...(await response.json()), cookies: response.headers.getSetCookie() };
}
