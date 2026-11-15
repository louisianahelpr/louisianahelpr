#!/usr/bin/env node
/**
 * PGlite proof for 20261115032241_cron_gateway_520_stuck_payment_check (Q2798): a
 * Cloudflare 520 (text/html, no edge-runtime stamp) on stuck-payment-check, a
 * catch-up sweep, is skipped once the job's next run answers 2xx, exactly as
 * 20261027141932 skips a gateway 502/503; everything else is filed as before.
 *
 *   node src/test/pglite/cronGateway520StuckPaymentCheck.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cronGateway520StuckPaymentCheck.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: the objects sweep_cron_http_failures
 * reads, net._http_response with its headers column, and stubs for
 * net.http_post and vault. The "before" body is cut from 20261027141932
 * (prod's, prosrc md5 c06633603fe3707525bccfbddeddeed0, measured 2026-11-15).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261115032241_cron_gateway_520_stuck_payment_check.sql`, "utf8");
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
await db.exec(cut("20261027141932_cron_gateway_5xx_needs_a_repeat.sql", "sweep_cron_http_failures"));
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

// The 2026-11-11 18:30Z body: Cloudflare's own page in front of the gateway.
let s = await scenario("stuck-payment-check", [[520, 15, GW], [200, 5, RT]]);
check("2026-11-11 shape: a Cloudflare 520 on stuck-payment-check, then its next 200, is not filed", (await filed(s.ids[0])) === 0, `${await filed(s.ids[0])} row(s)`);
check("  and the sweep counts it", Number(s.r.gateway_5xx_skipped) === 1 && (s.r.gateway_5xx_jobs ?? []).includes("stuck-payment-check"), JSON.stringify(s.r));
await sweep();
check("  and a re-read never files it later", (await filed(s.ids[0])) === 0);

s = await scenario("stuck-payment-check", [[502, 15, GW], [200, 5, RT]]);
check("a gateway 502 on stuck-payment-check, then a 200, is not filed (a catch-up sweep now)", (await filed(s.ids[0])) === 0);

s = await scenario("refund-request-sweep", [[520, 15, GW], [200, 5, RT]]);
check("a 520 on an already-listed catch-up sweep, then a 200, is not filed", (await filed(s.ids[0])) === 0);

s = await scenario("refund-request-sweep", [[502, 15, GW], [200, 5, RT]]);
check("2026-10-26 shape still holds: a gateway 502 then a 200 is not filed", (await filed(s.ids[0])) === 0);

s = await scenario("stuck-payment-check", [[520, 40, GW]]);
check("a 520 40 minutes old with no success since is filed", (await filed(s.ids[0])) === 1, `${await filed(s.ids[0])} row(s)`);

s = await scenario("stuck-payment-check", [[520, 5, GW]]);
check("a 520 5 minutes old with nothing since is not judged yet", (await filed(s.ids[0])) === 0);

s = await scenario("stuck-payment-check", [[520, 15, RT], [200, 5, RT]]);
check("a 520 carrying the edge runtime's stamp is filed even after a later 200", (await filed(s.ids[0])) === 1);

s = await scenario("stuck-payment-check", [[520, 15, "NULL"], [200, 5, RT]]);
check("a 520 with no headers kept is filed (no proof the function never ran)", (await filed(s.ids[0])) === 1);

s = await scenario("stuck-payment-check", [[504, 15, GW], [200, 5, RT]]);
check("a 504 on stuck-payment-check is still filed", (await filed(s.ids[0])) === 1);

s = await scenario("stuck-payment-check", [[500, 15, GW], [200, 5, RT]]);
check("a 500 on stuck-payment-check is still filed", (await filed(s.ids[0])) === 1);

s = await scenario("daily-report", [[520, 15, GW], [200, 5, RT]]);
check("a 520 on a job not listed as a catch-up sweep is filed even after a later 200", (await filed(s.ids[0])) === 1);

if (!MODE) {
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.sweep_cron_http_failures()', 'EXECUTE') a,
                                      has_function_privilege('authenticated', 'public.sweep_cron_http_failures()', 'EXECUTE') b`)).rows[0];
  check("no client can run the sweep", !acl.a && !acl.b, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
