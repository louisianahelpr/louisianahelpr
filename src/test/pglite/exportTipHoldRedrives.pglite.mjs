#!/usr/bin/env node
/**
 * PGlite proof for 20261005060801_export_includes_tip_hold_redrives (Q1297):
 * Download My Data gives a Helpr their tip re-pay ledger rows, and nobody else's.
 *
 *   node src/test/pglite/exportTipHoldRedrives.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/exportTipHoldRedrives.pglite.mjs   # RED: the live body
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * As exportPosterSide.pglite.mjs does, the section expression is cut VERBATIM
 * out of the migration's function body and evaluated with v_uid bound to a
 * caller, against tip_hold_redrives' live column shape (information_schema,
 * 2026-10-05). The whole function is also created 3x (plpgsql parses its body).
 * Under NEW_MIGRATION=skip the body is the live one (20261004192410, md5 =
 * live), which has no such section.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
const FILE = MODE === "skip"
  ? "../../../supabase/migrations/20261004192410_application_flags_per_direction.sql"
  : "../../../supabase/migrations/20261005060801_export_includes_tip_hold_redrives.sql";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the LIVE body (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const sql = read(FILE);
const fnStart = sql.search(/CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)/i);
const fnSql = sql.slice(fnStart);
const tag = /\bAS\s+(\$\w*\$)/i.exec(fnSql);
const bodyStart = tag.index + tag[0].length;
const body = fnSql.slice(bodyStart, fnSql.indexOf(tag[1], bodyStart));
const section = (name) => {
  const at = body.indexOf(`jsonb_build_object('${name}',`);
  if (at < 0) return null;
  const from = body.indexOf("(SELECT", at);
  let depth = 0;
  for (let i = from; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) return body.slice(from, i + 1);
  }
  return null;
};

const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const OTHER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const db = new PGlite();
await db.exec(`
CREATE TABLE public.tip_hold_redrives (
  tip_id uuid PRIMARY KEY, helper_id uuid NOT NULL, transfer_id text, amount_cents integer NOT NULL,
  status text NOT NULL, reversal_id text, repay_transfer_id text, failure_reason text,
  first_repay_attempt_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
INSERT INTO public.tip_hold_redrives (tip_id, helper_id, transfer_id, amount_cents, status) VALUES
  (gen_random_uuid(), '${HELPR}', 'tr_1', 500, 'held'),
  (gen_random_uuid(), '${HELPR}', 'tr_2', 300, 'repaid'),
  (gen_random_uuid(), '${OTHER}', 'tr_3', 900, 'held');
`);

const expr = section("tip_hold_redrives");
check("S1 export_my_data has a tip_hold_redrives section", expr !== null, expr ? "" : `not in ${FILE.split("/").pop()}`);
if (expr) {
  const run = async (uid) => {
    const q = `SELECT ${expr.replace(/\bv_uid\b/g, `'${uid}'::uuid`)} AS rows`;
    return (await db.query(q)).rows[0].rows;
  };
  const mine = await run(HELPR);
  check("S2 the Helpr gets their own two rows", Array.isArray(mine) && mine.length === 2 && mine.every((r) => r.helper_id === HELPR), JSON.stringify(mine?.map((r) => r.transfer_id)));
  const other = await run(OTHER);
  check("S3 another Helpr gets only theirs", other.length === 1 && other[0].transfer_id === "tr_3", JSON.stringify(other.map((r) => r.transfer_id)));
  const none = await run("00000000-0000-4000-8000-000000000000");
  check("S4 a person with no rows gets an empty list, not null", Array.isArray(none) && none.length === 0, JSON.stringify(none));
}

// The whole migration's function compiles (plpgsql parses the body) and re-applies.
await db.exec(`CREATE SCHEMA IF NOT EXISTS auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
const create = fnSql.slice(0, fnSql.indexOf(tag[1], bodyStart) + tag[1].length) + ";";
try {
  for (let i = 0; i < 3; i++) await db.exec(create);
  check("C1 export_my_data(uuid) as written compiles, applied 3x", true);
} catch (e) {
  check("C1 export_my_data(uuid) as written compiles, applied 3x", false, e.message);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
