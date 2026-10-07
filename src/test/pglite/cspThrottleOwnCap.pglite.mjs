#!/usr/bin/env node
/**
 * PGlite proof for 20261007122241_csp_reports_own_throttle_cap (docs/OPEN.md Q1351).
 *
 *   node src/test/pglite/cspThrottleOwnCap.pglite.mjs                       # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/cspThrottleOwnCap.pglite.mjs    # RED: the live throttle only
 *
 * Starts from the LIVE prod definitions (fixtures/throttleClientErrorLog.live.sql,
 * pg_get_functiondef 2026-10-07), applies the new migration 3x (replay-safe),
 * and proves, all inside one minute:
 *   - 100 CSP reports (distinct fingerprints) store 60; 40 are dropped as 'csp';
 *   - the guest crash budget is untouched by them: 300 NON-csp guest rows
 *     still all store after the CSP flood, and the 301st is dropped as 'guest';
 *   - the per-fingerprint cap (20) still applies to CSP rows;
 *   - server rows and signed-in rows are unchanged (never / 60 per account).
 * On the live throttle the CSP rows spend the 300 guest budget, which is the
 * defect (the RED run shows fewer than 300 crash rows stored).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const here = (p) => new URL(p, import.meta.url).pathname;
const LIVE = readFileSync(here("./fixtures/throttleClientErrorLog.live.sql"), "utf8");
const NEW = readFileSync(here("../../../supabase/migrations/20261007122241_csp_reports_own_throttle_cap.sql"), "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.error_logs (
    id bigserial PRIMARY KEY,
    user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    message text,
    url text,
    severity text,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb
  );
`);
await db.exec(LIVE);
await db.exec(`CREATE TRIGGER trg_error_logs_10_throttle BEFORE INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.throttle_client_error_log();`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

const count = async (where) => Number((await db.query(`SELECT count(*)::int AS n FROM public.error_logs WHERE ${where}`)).rows[0].n);
const drops = async (kind) => Number((await db.query(`SELECT coalesce(sum(dropped),0)::int AS n FROM public.error_log_throttle_drops WHERE drop_kind = $1`, [kind])).rows[0].n);
// ops_alert_normalise collapses digits, so a distinct fingerprint needs letters.
const word = (i) => { let w = ""; do { w = String.fromCharCode(97 + (i % 26)) + w; i = Math.floor(i / 26) - 1; } while (i >= 0); return w; };
const insert = (msg, tags, userId = null) =>
  db.query(`INSERT INTO public.error_logs (user_id, message, url, tags) VALUES ($1, $2, 'https://www.louisianahelpr.com/jobs', $3::jsonb)`, [userId, msg, JSON.stringify(tags)]);

// 100 CSP reports, each its own fingerprint. (A real report's blocked URL
// normalises to <url>, so per directive and page they already share one
// fingerprint and its cap of 20; distinct words stand in for many pages.)
for (let i = 0; i < 100; i++) await insert(`CSP violation: script-src-elem blocked ${word(i)}`, { origin: "client", source: "csp" });
const cspStored = await count(`tags->>'source' = 'csp'`);
check("CSP reports are capped at 60 a minute", cspStored === 60, `stored ${cspStored}`);
check("CSP drops are counted under their own kind", (await drops("csp")) === 40, `csp drops ${await drops("csp")}`);

// The crash budget: 300 distinct guest errors after the flood all store.
for (let i = 0; i < 301; i++) await insert(`TypeError ${word(i)} in Boot`, { origin: "client", source: "ErrorBoundary" });
const crashStored = await count(`coalesce(tags->>'source','') <> 'csp'`);
check("the CSP flood spends none of the 300 guest crash budget", crashStored === 300, `stored ${crashStored} of 301`);
check("the 301st guest crash row is dropped as 'guest'", (await drops("guest")) === 1, `guest drops ${await drops("guest")}`);

// The per-fingerprint cap still holds for CSP rows (same report 25x).
await db.exec(`DELETE FROM public.error_logs; DELETE FROM public.error_log_throttle_drops;`);
for (let i = 0; i < 25; i++) await insert(`CSP violation: img-src blocked https://same.example`, { origin: "client", source: "csp" });
check("one CSP fingerprint still stores at most 20", (await count(`true`)) === 20, `stored ${await count("true")}`);

// Server rows are never throttled; an account keeps its own 60.
await db.exec(`DELETE FROM public.error_logs;`);
for (let i = 0; i < 70; i++) await insert(`server ${i}`, { origin: "server", source: "csp" });
check("server rows are never throttled", (await count(`tags->>'origin' = 'server'`)) === 70);
for (let i = 0; i < 70; i++) await insert(`acct ${i}`, { origin: "client" }, "aaaaaaaa-0000-0000-0000-000000000001");
check("a signed-in account still stores 60 a minute", (await count(`user_id IS NOT NULL`)) === 60);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
