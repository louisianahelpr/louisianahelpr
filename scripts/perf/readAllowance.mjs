/**
 * The READ ALLOWANCE of scripts/perf/cwv-lab.mjs (`--allow-reads`): which of a
 * signed-in prod screen's non-GET requests are reads of the test account's own
 * data and may pass the lab's write block. Its own module (no shebang) so the
 * vitest guard src/test/cwvLabBlocksProdWrites.test.ts can import it.
 *
 * `reads` is null unless the run passed --allow-reads; `reads.rpcs` is the
 * comma list of prod's STABLE/IMMUTABLE public functions (pg_proc.provolatile),
 * `reads.refresh` is set only for an --expired run.
 */
export function allowedRead(reads, method, url, body) {
  if (!reads || method !== "POST") return null;
  const u = new URL(url);
  if (!/(^|\.)supabase\.co$/.test(u.hostname)) return null;
  const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(u.pathname)?.[1];
  if (rpc) return reads.rpcs.has(rpc) ? `rpc:${rpc}` : null;
  if (reads.refresh && u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token") return "auth:refresh";
  if (u.pathname === "/functions/v1/stripe-connect") {
    let action = null;
    try { action = JSON.parse(body ?? "")?.action ?? null; } catch { /* not JSON: not the status read */ }
    return action === "status" ? "fn:stripe-connect:status" : null;
  }
  return null;
}

