/**
 * THE SYNTHETIC HALF OF THE USER-ERROR-SCREEN CLOSE RULE — docs/OPEN.md Q94.
 *
 * Owner spec (Q39): a real person's error-screen ledger item closes only when
 * the screen went 24h without a real person seeing it AND a synthetic check of
 * that route passes. ops_alert_condition('user-error-screen') (migration
 * 20260923182022) now asks public.ops_route_probe for a pass newer than the
 * item's last_seen; this file decides which screens a press run passed and
 * writes them through public.record_route_probe_passes (service_role only).
 *
 * A SCREEN (pathname; the query is dropped because the app's `screen` tag is
 * pathname-only, src/lib/currentScreen.ts) PASSES only when, in this shard:
 *   - at least one row on it was measured to the end (status "ok"), and
 *   - no row on it failed: no failed press, no error on load, no harness
 *     error, no row cut short by the time budget.
 * Rows that measured nothing say nothing either way: a redirect (anon sent to
 * /login), an uncovered persona, a row walked with a dead session.
 * So /admin passes only if every /admin?view=… row in the shard was clean.
 */

const NEUTRAL = new Set(["redirect", "uncovered", "session-lost"]);

/** Pathname of a route url (query and hash dropped). */
export function screenOf(url) {
  return String(url ?? "").split("?")[0].split("#")[0] || "/";
}

/**
 * @param {Array<{route: string, status: string, failed?: number}>} results
 * @returns {string[]} pathnames this run walked cleanly, sorted.
 */
export function routeProbePasses(results) {
  const byScreen = new Map();
  for (const r of results ?? []) {
    if (NEUTRAL.has(r.status)) continue;
    const key = screenOf(r.route);
    const v = byScreen.get(key) ?? { clean: 0, dirty: 0 };
    if (r.status === "ok" && !(r.failed > 0)) v.clean++;
    else v.dirty++;
    byScreen.set(key, v);
  }
  return [...byScreen].filter(([, v]) => v.clean > 0 && v.dirty === 0).map(([k]) => k).sort();
}

function env(name) {
  return process.env[name];
}

/**
 * Write the passes. Needs SUPABASE_SERVICE_ROLE_KEY (the press workflow writes
 * it to .env for session minting). A missing key or a failed write returns
 * { ok: false } for the caller to print: the close rule then simply stays
 * failing (fail-safe), it never closes on a pass that was not recorded.
 */
export async function recordRouteProbePasses(routes, runRef, { fetchImpl = fetch, readEnvFile } = {}) {
  const fromFile = (name) => {
    try {
      const text = readEnvFile ? readEnvFile() : null;
      const m = text && new RegExp(`^${name}=(.*)$`, "m").exec(text);
      return m?.[1]?.replace(/^["']|["']$/g, "");
    } catch { return undefined; }
  };
  const url = (env("SUPABASE_URL") ?? env("VITE_SUPABASE_URL") ?? fromFile("VITE_SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? fromFile("SUPABASE_SERVICE_ROLE_KEY");
  if (!routes?.length) return { ok: true, recorded: 0 };
  if (!url || !key) return { ok: false, recorded: 0, why: "no SUPABASE_SERVICE_ROLE_KEY / URL: passes not recorded (close rule stays failing)" };
  try {
    const res = await fetchImpl(`${url}/rest/v1/rpc/record_route_probe_passes`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_routes: routes, p_run_ref: String(runRef ?? "").slice(0, 200) }),
    });
    if (!res.ok) return { ok: false, recorded: 0, why: `record_route_probe_passes HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const n = await res.json();
    return { ok: true, recorded: Number(n) || 0 };
  } catch (e) {
    return { ok: false, recorded: 0, why: `record_route_probe_passes failed: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}
