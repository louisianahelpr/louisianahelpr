#!/usr/bin/env node
/**
 * PGlite proof for 20261021020915_job_match_reach.sql (board 184, reached only).
 *
 *   node src/test/pglite/jobMatchReach.pglite.mjs
 *
 * The whole migration file applied 3x (replay). auth.uid() and require_feature() are stubs driven by session
 * settings; jobs / job_match_queue / feature_switches cut to the columns read. Checks: the poster reads the
 * distinct members whose alert was SENT (queued, digested and dropped never count); another member, a
 * missing id and an ownerless job read 0; the switch off refuses; anon has no EXECUTE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SQL = readFileSync(new URL("../../../supabase/migrations/20261021020915_job_match_reach.sql", import.meta.url).pathname, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const POSTER = U(1), OTHER = U(2), JOB = U(10), ORPHAN = U(11);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF coalesce(current_setting('test.feature', true), '') <> 'on' THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid);
  CREATE TABLE public.job_match_queue (id serial PRIMARY KEY, job_id uuid, user_id uuid, status text, drop_reason text);
  INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}'), ('${ORPHAN}', NULL);
  INSERT INTO public.job_match_queue (job_id, user_id, status, drop_reason) VALUES
    ('${JOB}', '${U(20)}', 'sent', NULL), ('${JOB}', '${U(21)}', 'sent', NULL), ('${JOB}', '${U(22)}', 'sent', NULL),
    ('${JOB}', '${U(23)}', 'queued', NULL), ('${JOB}', '${U(24)}', 'digested', NULL),
    ('${JOB}', '${U(25)}', 'dropped', 'error: push'), ('${JOB}', '${U(26)}', 'dropped', 'blocked'),
    ('${ORPHAN}', '${U(20)}', 'sent', NULL);
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const reach = async (uid, job = JOB, feature = "on") => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET test.feature = '${feature}'`);
  return (await db.query(`SELECT public.get_job_match_reach('${job}') AS n`)).rows[0].n;
};
check("the poster reads 3: only 'sent' counts (queued, digested, dropped never)", (await reach(POSTER)) === 3);
check("another member reads 0", (await reach(OTHER)) === 0);
check("signed out reads 0", (await reach(null)) === 0);
check("a missing job id reads 0", (await reach(POSTER, U(99))) === 0);
check("an ownerless job reads 0", (await reach(POSTER, ORPHAN)) === 0);
let refused = false;
try { await reach(POSTER, JOB, "off"); } catch (e) { refused = /feature_disabled/.test(String(e.message)); }
check("switch off: refused", refused);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'get_job_match_reach'`)).rows[0].a;
check("EXECUTE for authenticated only (no anon, no PUBLIC)", /authenticated=X/.test(acl) && !/anon=/.test(acl) && !/(^|\{|,)=X/.test(acl));
console.log(`${n - fails}/${n} pass (3x applied)`);
process.exit(fails ? 1 : 0);
