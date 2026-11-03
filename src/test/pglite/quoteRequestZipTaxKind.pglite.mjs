#!/usr/bin/env node
/**
 * PGlite proof for 20261103205121_quote_request_zip_tax_kind.sql (Q2083 b, quote-request bookings).
 *
 *   npx tsx src/test/pglite/quoteRequestZipTaxKind.pglite.mjs [--before]
 *
 * Both modes first load the PREVIOUS create_quote_request and quote_insert_job (their effective definitions before
 * this file, src/test/helpers/effectiveFunctionDefs.ts) with prod's grants. --before stops there and prints
 * their md5(pg_get_functiondef), to compare with prod's; the new checks must FAIL. Without it the WHOLE new
 * migration is applied 3x (replay) on top and every check must PASS.
 *
 * job_quote_requests is the real CREATE TABLE from 20261015091114_job_quotes.sql; is_job_labor_taxable is
 * its effective definition (20261102152453). Stubs (not under test): auth.uid() reads a session setting,
 * require_feature / quote_require_member / is_caller_banned pass, jobs is cut down to the columns
 * quote_insert_job writes plus the real jobs_tax_kind_valid CHECK, job_category carries the values used here.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103205121_quote_request_zip_tax_kind.sql";
// QRZ_MIGRATION: a planted-defect copy, for the mutant runs in the report.
const MIGRATION = readFileSync(process.env.QRZ_MIGRATION ?? DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

const DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function tableStmt(file, table) {
  const sql = readFileSync(DIR + file, "utf8");
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  return sql.slice(start, sql.indexOf("\n);", start) + 3);
}

const POSTER = "00000000-0000-0000-0000-00000000000a";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${POSTER}');
CREATE TYPE public.job_category AS ENUM ('other', 'handyman', 'cleaning', 'auto_repair', 'appliance_repair');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles VALUES ('${POSTER}', false);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, description text,
  category public.job_category, date_needed date, start_time time, estimated_hours numeric, location text,
  latitude numeric, longitude numeric, parish text, budget numeric, offered_to_helper_id uuid,
  direct_offer_expires_at timestamptz, zip_code text, tax_kind text,
  CONSTRAINT jobs_tax_kind_valid CHECK (tax_kind IS NULL OR tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations')));
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.quote_require_member() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
${tableStmt("20261015091114_job_quotes.sql", "job_quote_requests")}
${fnStmt("is_job_labor_taxable")}
`);

// Prod's state first in both modes (the old 11-arg create_quote_request and quote_insert_job with prod's
// grants), so the after run proves the migration REPLACES them, not that it works on an empty schema.
await db.exec(`${fnStmt("create_quote_request")}\n${fnStmt("quote_insert_job")}
REVOKE ALL ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.quote_insert_job(public.job_quote_requests, numeric, uuid) FROM PUBLIC, anon, authenticated;`);
if (BEFORE) {
  const md5s = await db.query(
    `SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS md5, length(pg_get_functiondef(p.oid)) AS len
       FROM pg_proc p WHERE p.proname IN ('create_quote_request', 'quote_insert_job') ORDER BY 1`);
  for (const r of md5s.rows) console.log(`before-def ${r.proname} md5 ${r.md5} (${r.len} chars)`);
} else {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

await db.exec(`SET request.jwt.claim.sub = '${POSTER}'`);
const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const tryQ = async (sql, params = []) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message), code: e.code }; }
};
const ask = (category, zip, taxKind) => tryQ(
  `SELECT public.create_quote_request(p_title => 'Fix the thing', p_description => 'Ten chars or more here',
     p_category => $1, p_date_needed => (current_date + 5), p_zip_code => $2, p_tax_kind => $3) AS id`,
  [category, zip, taxKind]);
const book = async (reqId) => {
  const r = await tryQ(
    `SELECT public.quote_insert_job(r, 120, NULL) AS job FROM public.job_quote_requests r WHERE r.id = $1`, [reqId]);
  return r.error ? r : (await db.query(`SELECT zip_code, tax_kind FROM public.jobs WHERE id = $1`, [r.rows[0].job])).rows[0];
};

// 1. A taxed-kind request (ZIP+4 sent) books a job with the ZIP and the answer.
const a = await ask("handyman", "70112-1234", "item_repair");
const aJob = a.error ? null : await book(a.rows[0].id);
check("a quote-booked job carries the request's 5-digit ZIP", aJob?.zip_code === "70112");
check("a quote-booked job carries the poster's tax_kind", aJob?.tax_kind === "item_repair");

// 2. Auto Repair: the ZIP rides along, the tax_kind is dropped (the category taxes the labor).
const b = await ask("auto_repair", "70501", "item_repair");
const bJob = b.error ? null : await book(b.rows[0].id);
check("an Auto Repair quote job carries its ZIP", bJob?.zip_code === "70501");
check("an Auto Repair quote job stores tax_kind NULL", !!bJob && bJob.tax_kind === null);

// 3. Refusals, each 22023 (PostgREST 400), nothing inserted.
const count = async () => Number((await db.query(`SELECT count(*)::int AS n FROM public.job_quote_requests`)).rows[0].n);
const before = await count();
const tx = await ask("handyman", "77002", null);
check("a Texas ZIP is refused invalid_zip / 22023", /invalid_zip/.test(tx.error ?? "") && tx.code === "22023");
const none = await ask("handyman", null, null);
check("no ZIP is refused invalid_zip / 22023", /invalid_zip/.test(none.error ?? "") && none.code === "22023");
const top = await ask("handyman", "71500", null);
check("71500 (past 714xx) is refused", /invalid_zip/.test(top.error ?? ""));
const bad = await ask("handyman", "70112", "massage");
check("an unknown tax_kind is refused invalid_tax_kind / 22023", /invalid_tax_kind/.test(bad.error ?? "") && bad.code === "22023");
check("no refused call inserted a request", (await count()) === before);

// 4. Exactly one create_quote_request, the 13-argument one; grants as before.
const sigs = (await db.query(
  `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl FROM pg_proc p WHERE p.proname = 'create_quote_request'`)).rows;
check("exactly one create_quote_request (the old 11-arg overload is gone)", sigs.length === 1 && sigs[0].sig.split(",").length === 13);
const acl = sigs[0]?.acl ?? "";
check("create_quote_request: authenticated may execute, anon and PUBLIC may not",
  /authenticated=X/.test(acl) && !/anon=/.test(acl) && !/(^|[{,])=X/.test(acl));
const qacl = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'quote_insert_job'`)).rows[0]?.acl ?? "";
check("quote_insert_job: no authenticated, anon or PUBLIC execute", !/authenticated=|anon=|(^|[{,])=X/.test(qacl));

// 5. An older app's 11 named arguments still resolve (no overload ambiguity) and get a 400, not a 500.
const old = await tryQ(
  `SELECT public.create_quote_request(p_title => 'Fix the thing', p_description => 'Ten chars or more here',
     p_category => 'handyman', p_date_needed => (current_date + 5), p_start_time => NULL, p_estimated_hours => NULL,
     p_location => NULL, p_latitude => NULL, p_longitude => NULL, p_parish => NULL, p_window_hours => 48)`);
check("an 11-named-argument call reaches the new function and is refused invalid_zip / 22023",
  /invalid_zip/.test(old.error ?? "") && old.code === "22023");

const fails = checks.filter(([, ok]) => !ok).length;
console.log(BEFORE ? `before: ${fails} of ${checks.length} failed (the gap must show)` : `after: ${checks.length - fails}/${checks.length} pass (3x applied)`);
process.exit(BEFORE ? (fails >= 8 ? 0 : 1) : fails === 0 ? 0 : 1);
