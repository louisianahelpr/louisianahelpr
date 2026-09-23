#!/usr/bin/env node
/**
 * Q317 (docs/OPEN.md, 2026-09-23): the Postgres connection budget.
 *
 * prod has max_connections = 60, 3 of them reserved for superusers. pg_cron
 * runs with cron.use_background_workers = off, so EVERY job opens a fresh
 * connection as postgres. When the services' pools filled the rest during a
 * prod test suite, 14 cron jobs were refused at 19:00Z ("remaining connection
 * slots are reserved for roles with the SUPERUSER attribute").
 *
 * This check adds up what may hold a connection at once and fails if it does
 * not fit in what non-superusers can open:
 *
 *   usable  = max_connections - superuser_reserved_connections - reserved_connections   (live SQL)
 *   demand  = PostgREST db_pool                       (Management API /postgrest)
 *           + pooler default_pool_size, every pool    (Management API /config/database/pooler)
 *           + Auth db_max_pool_size, when exposed     (Management API /config/auth)
 *           + other client backends right now         (live SQL: realtime, exporters, ...;
 *                                                      not PostgREST/pooler/auth/cron, counted above)
 *           + CRON_RESERVE                            (max(10, busiest minute of cron starts, 2 days))
 *   fail when demand > usable.
 *
 * Fails closed: a read that fails, an empty read, or a pool size the API does
 * not state (PostgREST db_pool null = a server default nobody can read) is a
 * red run, never a pass.
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF. Test seam: LH_SUPABASE_API_BASE.
 * Wired into .github/workflows/quota-monitor.yml (job db_pool_budget).
 */
const env = process.env;
const SUPA = env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
const REF = env.SUPABASE_PROJECT_REF;
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
/** Measured 2026-09-23: 10 cron jobs started in the 14:00Z minute. */
export const CRON_RESERVE_FLOOR = 10;

export const BUDGET_SQL = `
SELECT current_setting('max_connections')::int AS max_conns,
       current_setting('superuser_reserved_connections')::int AS su_reserved,
       coalesce(nullif(current_setting('reserved_connections', true), ''), '0')::int AS reserved,
       (SELECT count(*) FROM pg_stat_activity
         WHERE backend_type = 'client backend'
           AND coalesce(usename, '') NOT IN ('authenticator', 'pgbouncer', 'supavisor', 'supabase_auth_admin', 'postgres')
           AND coalesce(application_name, '') NOT ILIKE 'supavisor%')::int AS other_conns,
       (SELECT coalesce(max(c), 0) FROM (
          SELECT count(*) AS c FROM cron.job_run_details
           WHERE start_time > now() - interval '2 days'
           GROUP BY date_trunc('minute', start_time)) m)::int AS cron_peak_minute`;

function die(msg) {
  console.error(`::error title=db pool budget::${msg}`);
  process.exit(1);
}

async function getJson(path, init) {
  const res = await fetch(`${SUPA}/v1/projects/${REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Management API ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

async function main() {
  if (!TOKEN || !REF) die("could not read the pool config: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");

  let rows, postgrest, pooler, auth;
  try {
    rows = await getJson("/database/query", { method: "POST", body: JSON.stringify({ query: BUDGET_SQL, read_only: true }) });
    postgrest = await getJson("/postgrest");
    pooler = await getJson("/config/database/pooler");
  } catch (e) {
    die(`could not read the pool config: ${e?.message ?? e}`);
  }
  try {
    auth = await getJson("/config/auth");
  } catch (e) {
    console.log(`::warning title=db pool budget::Auth config unreadable (${e?.message ?? e}); its pool is not counted`);
  }

  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r || !isCount(r.max_conns) || r.max_conns === 0) die("the connection SQL returned no row — refusing to report clean");

  const dbPool = postgrest && typeof postgrest === "object" && !Array.isArray(postgrest) ? postgrest.db_pool : undefined;
  // Every raw reading first, so a red run still records what prod is set to.
  const poolerRaw = (Array.isArray(pooler) ? pooler : [pooler]).map((p) => ({
    database_type: p?.database_type, pool_mode: p?.pool_mode, default_pool_size: p?.default_pool_size, max_client_conn: p?.max_client_conn,
  }));
  console.log(`read: sql ${JSON.stringify(r)}`);
  console.log(`read: postgrest db_pool ${JSON.stringify(dbPool)}; pooler ${JSON.stringify(poolerRaw)}; auth db_max_pool_size ${JSON.stringify(auth?.db_max_pool_size)}`);
  if (!isCount(dbPool)) {
    die(`PostgREST db_pool is ${JSON.stringify(dbPool)}: unset means a server default the API does not state — refusing to report clean. Set it explicitly (Management API PATCH /postgrest).`);
  }

  const pools = Array.isArray(pooler) ? pooler : pooler ? [pooler] : [];
  const poolSizes = pools.map((p) => p?.default_pool_size);
  if (!poolSizes.length || !poolSizes.every(isCount)) {
    die(`pooler config read as ${JSON.stringify(poolSizes)} — refusing to report clean`);
  }
  const poolerTotal = poolSizes.reduce((a, b) => a + b, 0);

  const authPool = auth && isCount(auth.db_max_pool_size) ? auth.db_max_pool_size : 0;
  if (auth && !isCount(auth.db_max_pool_size)) {
    console.log("::warning title=db pool budget::Auth db_max_pool_size not stated by the API; Auth's pool is not counted");
  }

  const usable = r.max_conns - r.su_reserved - r.reserved;
  const cronReserve = Math.max(CRON_RESERVE_FLOOR, r.cron_peak_minute);
  const demand = dbPool + poolerTotal + authPool + r.other_conns + cronReserve;

  console.log(`usable  = max_connections ${r.max_conns} - superuser_reserved ${r.su_reserved} - reserved ${r.reserved} = ${usable}`);
  console.log(
    `demand  = PostgREST db_pool ${dbPool} + pooler ${poolSizes.join("+")} + Auth ${authPool} + other backends now ${r.other_conns} + cron reserve ${cronReserve} (peak minute ${r.cron_peak_minute}) = ${demand}`,
  );
  if (demand > usable) die(`pools may hold ${demand} connections but only ${usable} are usable: pg_cron will be refused under load (Q317)`);
  console.log(`OK: ${usable - demand} connection(s) of headroom`);
}

await main();
