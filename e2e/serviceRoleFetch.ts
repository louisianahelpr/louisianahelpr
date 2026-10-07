/**
 * SERVICE-ROLE REQUESTS GO THROUGH NODE'S fetch, NEVER A PLAYWRIGHT REQUEST
 * CONTEXT (docs/OPEN.md Q1421).
 *
 * A Playwright APIRequestContext is traced: on failure CI uploads trace.zip,
 * and a trace copies every request's headers and body verbatim. The repo is
 * PUBLIC, so a service-role key in an `api.get(url, { headers })` call is a
 * key any signed-in GitHub user can download (lh-authz-rls review,
 * 2026-10-06: a journeys artifact held user JWTs and a password-grant body).
 * scripts/lib/adminSession.mjs already mints sessions this way; this is the
 * same rule for every other service-role call an e2e helper makes.
 *
 * The answer mimics the slice of Playwright's APIResponse the callers use
 * (ok(), status(), text(), json()), with the body read once.
 * Guard: src/test/e2eServiceRoleNeverTraced.test.ts.
 */
export type FetchedResponse = {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

/** The service-role headers (apikey + Bearer), plus any extras such as Prefer. */
export function serviceHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

export async function srFetch(
  key: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD",
  url: string,
  opts: { extra?: Record<string, string>; data?: unknown; timeoutMs?: number } = {},
): Promise<FetchedResponse> {
  const r = await fetch(url, {
    method,
    headers: serviceHeaders(key, opts.extra),
    body: opts.data === undefined ? undefined : typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  });
  const text = method === "HEAD" ? "" : await r.text();
  return {
    ok: () => r.ok,
    status: () => r.status,
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}
