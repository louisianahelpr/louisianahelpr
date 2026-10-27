#!/usr/bin/env node
/**
 * PGlite proof for 20261027141932_cron_gateway_5xx_needs_a_repeat: a 502/503/504
 * the platform's gateway answered without reaching the function is filed only
 * when the job has not succeeded since (30+ minutes on); everything else is
 * filed as before.
 *
 *   node src/test/pglite/cronGateway5xxNeedsARepeat.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cronGateway5xxNeedsARepeat.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: the objects sweep_cron_http_failures
 * reads, net._http_response with its headers column, and stubs for
 * net.http_post and vault. The "before" body is cut from 20261012202854
 * (prod's, md5 68dfbf43b535f2ea84b893019eed2e03, measured 2026-10-27).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261027141932_cron_gateway_5xx_needs_a_repeat.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA net; CREATE SCHEMA cron; CREATE SCHEMA vault;
  CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code int, timed_out boolean, error_msg text,
    created timestamptz, content text, headers jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, command text, active boolean DEFAULT true);
  CREATE TABLE public.cron_http_requests (request_id bigint, jobname text, created_at timestamptz);
  CREATE TABLE public.cron_catchup_runs (jobname text, slot timestamptz, request_id bigint, decided_at timestamptz,
    action text, http_checked_at timestamptz, http_status int, detail text);
  CREATE TABLE public.error_logs (id uuid DEFAULT gen_random_uuid(), severity text, message text, tags jsonb,
    context jsonb, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_job_first_seen (jobname text PRIMARY KEY, first_seen timestamptz NOT NULL DEFAULT now());
`);
await db.exec(cut("20261012202854_cron_first_run_404_grace.sql", "sweep_cron_http_failures"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

// Headers as prod's net._http_response holds them (measured 2026-10-27 on a
// declutter-money 200): the runtime stamps x-served-by and x-deno-execution-id.
// The 2026-10-26 502s were text/html with neither (function_edge_logs).
const RT = `'{"x-served-by":"supabase-edge-runtime","x-deno-execution-id":"e1","content-type":"application/json"}'::jsonb`;
const GW = `'{"server":"cloudflare","content-type":"text/html"}'::jsonb`;
const RT_UPPER = `'{"X-Served-By":"supabase-edge-runtime","Content-Type":"text/html"}'::jsonb`;
const GW_JSON = `'{"server":"cloudflare","content-type":"application/json"}'::jsonb`;

const sweep = async () => (await db.query(`SELECT public.sweep_cron_http_failures() AS r`)).rows[0].r;
const filed = async (rid) => Number((await db.query(`SELECT count(*)::int n FROM public.error_logs WHERE context->>'response_id' = '${rid}'`)).rows[0].n);

// One scenario = one job's responses, oldest first: [status, minutesAgo, headersSql].
let nextId = 1;
async function scenario(job, rows) {
  await db.exec(`DELETE FROM net._http_response; DELETE FROM public.cron_http_requests; DELETE FROM public.error_logs;
    INSERT INTO cron.job (jobname, command) SELECT '${job}', 'SELECT public.cron_http_tag(''${job}'', net.http_post(''x''))'
      WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${job}');
    INSERT INTO public.cron_job_first_seen VALUES ('${job}', '-infinity') ON CONFLICT DO NOTHING;`);
  const ids = [];
  for (const [status, ago, headers] of rows) {
    const id = nextId++;
    ids.push(id);
    await db.exec(`INSERT INTO net._http_response VALUES (${id}, ${status}, false, NULL, now() - interval '${ago} minutes', '', ${headers});
                   INSERT INTO public.cron_http_requests VALUES (${id}, '${job}', now() - interval '${ago} minutes');`);
  }
  return { ids, r: await sweep() };
}

let s = await scenario("refund-request-sweep", [[502, 15, GW], [200, 5, RT]]);
check("2026-10-26 shape: a gateway 502 on a catch-up sweep, then its next 200, is not filed", (await filed(s.ids[0])) === 0, `${await filed(s.ids[0])} row(s)`);
check("  and the sweep counts it", Number(s.r.gateway_5xx_skipped) === 1 && (s.r.gateway_5xx_jobs ?? []).includes("refund-request-sweep"), JSON.stringify(s.r));
await sweep();
check("  and a re-read never files it later", (await filed(s.ids[0])) === 0);

s = await scenario("declutter-money", [[503, 40, GW], [200, 30, RT]]);
check("a gateway 503 on a catch-up sweep, then a 200, is not filed", (await filed(s.ids[0])) === 0);

s = await scenario("declutter-money", [[502, 40, GW]]);
check("a gateway 502 40 minutes old with no success since is filed", (await filed(s.ids[0])) === 1, `${await filed(s.ids[0])} row(s)`);
await sweep();
check("  once", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[502, 5, GW]]);
check("a gateway 502 5 minutes old with nothing since is not judged yet", (await filed(s.ids[0])) === 0);
await db.exec(`UPDATE net._http_response SET created = now() - interval '35 minutes' WHERE id = ${s.ids[0]};
               UPDATE public.cron_http_requests SET created_at = now() - interval '35 minutes' WHERE request_id = ${s.ids[0]};`);
await sweep();
check("  ...and is filed once 30+ minutes old with still no success", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[504, 15, GW], [200, 5, RT]]);
check("a gateway 504 is filed (it may be our function running past its time limit)", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[502, 15, RT], [200, 5, RT]]);
check("the FUNCTION's own 502 (runtime headers) is filed even after a later 200", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[502, 15, RT_UPPER], [200, 5, RT]]);
check("runtime headers in any letter case still mark the function's own 502 (filed)", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[502, 15, "NULL"], [200, 5, RT]]);
check("a 502 with no headers kept is filed (no proof the function never ran)", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[502, 15, GW_JSON], [200, 5, RT]]);
check("a 502 that is not text/html is filed (no positive gateway evidence)", (await filed(s.ids[0])) === 1);

s = await scenario("declutter-money", [[500, 15, GW], [200, 5, RT]]);
check("a gateway 500 is filed (the grace is 502/503 only)", (await filed(s.ids[0])) === 1);

s = await scenario("daily-report", [[502, 15, GW], [200, 5, RT]]);
check("a job not listed as a catch-up sweep is filed even after a later 200", (await filed(s.ids[0])) === 1);

if (!MODE) {
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.sweep_cron_http_failures()', 'EXECUTE') a,
                                      has_function_privilege('authenticated', 'public.sweep_cron_http_failures()', 'EXECUTE') b`)).rows[0];
  check("no client can run the sweep", !acl.a && !acl.b, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
