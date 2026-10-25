#!/usr/bin/env node
/**
 * PGlite proof for 20261025214015_helpr_fee_sql_default_is_ten.
 *
 *   node src/test/pglite/helprFeeSqlDefaultIsTen.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/helprFeeSqlDefaultIsTen.pglite.mjs   # RED
 *
 * Loads helpr_flat_fee_cents and get_payout_batches from the migrations that
 * define them (with their grants), applies the new migration 3x, and checks:
 * an unstamped percent now defaults to 10 (10000c share -> 1070c), a stamped
 * job keeps its own percent (5% -> 570c), the grants survive, replay is a no-op.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261025214015_helpr_fee_sql_default_is_ten.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let stmt = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    if (!tag) continue;
    const open = tag.index + tag[0].length;
    const close = rest.indexOf(tag[1], open) + tag[1].length;
    const tail = rest.slice(close).match(/^[^;]*;/);
    stmt = rest.slice(0, close) + (tail ? tail[0] : ";");
  }
  return stmt;
}

const db = new PGlite();
await db.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;`);
for (const [fn, file] of [["helpr_flat_fee_cents", "20261017104746_sql_notices_exports_flat_fee.sql"], ["get_payout_batches", "20261015034233_payout_batches_flat_fee.sql"]]) {
  const stmt = lastDefinition(mig(file), fn);
  check(`${fn} found in ${file}`, !!stmt);
  await db.exec(`SET check_function_bodies = off; ${stmt}`);
}
await db.exec(`REVOKE ALL ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) TO service_role;`);
const acl = async () => (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'helpr_flat_fee_cents'`)).rows[0].a;
const aclBefore = await acl();
const src = async () => (await db.query(`SELECT string_agg(prosrc, '|' ORDER BY proname) AS s FROM pg_proc WHERE proname IN ('helpr_flat_fee_cents','get_payout_batches')`)).rows[0].s;
if (!MODE) await db.exec(`SET check_function_bodies = off; ${NEW}`);
const once = await src();
if (!MODE) { await db.exec(`SET check_function_bodies = off; ${NEW}`); await db.exec(`SET check_function_bodies = off; ${NEW}`); }
const after = await src();
const q = async (sql) => Number((await db.query(sql)).rows[0].v);
check("an unstamped percent defaults to 10: $100 share -> $10.70", (await q(`SELECT public.helpr_flat_fee_cents(10000, NULL, NULL) AS v`)) === 1070);
check("a job stamped 5% keeps it: $100 share -> $5.70", (await q(`SELECT public.helpr_flat_fee_cents(10000, 5, 70) AS v`)) === 570);
check("a job stamped 10% pays 10%: $100 share -> $10.70", (await q(`SELECT public.helpr_flat_fee_cents(10000, 10, 70) AS v`)) === 1070);
check("get_payout_batches defaults an unstamped percent to 10", /COALESCE\(j\.helper_fee_percent, 10\)/.test(after) && !/COALESCE\(j\.helper_fee_percent, 5\)/.test(after));
check("grants survive the rewrite (service_role only)", (await acl()) === aclBefore && /service_role=X/.test(aclBefore) && !/anon|authenticated/.test(aclBefore), aclBefore);
check("applying it again changes nothing (replay-safe)", once === after);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
