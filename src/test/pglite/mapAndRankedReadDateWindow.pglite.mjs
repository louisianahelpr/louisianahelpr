#!/usr/bin/env node
/**
 * PGlite proof for 20261104080753_map_and_ranked_read_date_window (Q2408 part 3): get_open_jobs_for_map and
 * get_ranked_open_jobs keep a window job ("any day Nov 4-10") until the window's LAST day and return
 * date_window_end as their last column; NOTHING else about them changes (same rows for one-day jobs, same
 * arguments, SECURITY DEFINER, STABLE, search_path + TimeZone, EXECUTE as live, the ranked feed's COMMENT).
 *
 *   node src/test/pglite/mapAndRankedReadDateWindow.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/mapAndRankedReadDateWindow.pglite.mjs # RED: the state before it
 *
 * The "before" functions are each one's newest definition (20261027185146_card_hold_at_post.sql) with the grants
 * and COMMENT of 20261025235701. job_offer_cutoff is its real definition (20261005184940); other helpers are
 * stubbed permissive.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261104080753_map_and_ranked_read_date_window.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before Q2408 part 3 (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** One function cut from a migration: its newest `start` to the end of its dollar-quoted body. */
function cut(file, start) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf(start);
  if (st < 0) throw new Error(`${start} not in ${file}`);
  const tag = sql.slice(st).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = sql.indexOf(tag, st) + tag.length;
  return sql.slice(st, sql.indexOf(tag, bodyStart) + tag.length) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('yard', 'moving', 'cleaning');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 100,
  date_needed date, start_time time, location text DEFAULT 'Lafayette, LA', is_urgent boolean DEFAULT false,
  urgent_fee numeric, is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[],
  special_requirements text, status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '3 days',
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, is_seed boolean DEFAULT false, helper_fee_flat_cents int, helper_fee_percent numeric,
  date_window_end date
);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text, subscription_expires_at timestamptz);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "CREATE OR REPLACE FUNCTION public.job_offer_cutoff("));
// BEFORE: each function's newest definition, with its newest stated grants and COMMENT.
await db.exec(cut("20261027185146_card_hold_at_post.sql", "CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs("));
await db.exec(cut("20261027185146_card_hold_at_post.sql", "CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map("));
{
  const g = read(`${MIGDIR}20261025235701_browse_carries_helper_fee_percent.sql`);
  for (const sig of ["get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric)", "get_open_jobs_for_map()"]) {
    const r = g.indexOf(`REVOKE ALL ON FUNCTION public.${sig}`);
    const gr = g.indexOf(`GRANT EXECUTE ON FUNCTION public.${sig}`);
    await db.exec(g.slice(r, g.indexOf(";", r) + 1) + g.slice(gr, g.indexOf(";", gr) + 1));
  }
  const at = g.indexOf("COMMENT ON FUNCTION public.get_ranked_open_jobs(");
  await db.exec(g.slice(at, g.indexOf("never a number.';", at) + "never a number.';".length));
}

// Rows. Dates are relative to the Chicago calendar day so the proof never depends on the clock.
const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const today = "(now() AT TIME ZONE 'America/Chicago')::date";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, date_needed, date_window_end) VALUES
    ('10000000-0000-4000-8000-000000000001', 'window_started', '${P}', ${today} - 2, ${today} + 3),
    ('10000000-0000-4000-8000-000000000002', 'window_future', '${P}', ${today} + 1, ${today} + 6),
    ('10000000-0000-4000-8000-000000000003', 'window_over', '${P}', ${today} - 8, ${today} - 2),
    ('10000000-0000-4000-8000-000000000004', 'oneday_past', '${P}', ${today} - 1, NULL),
    ('10000000-0000-4000-8000-000000000005', 'oneday_future', '${P}', ${today} + 2, NULL),
    ('10000000-0000-4000-8000-000000000006', 'undated', '${P}', NULL, NULL);`);

const SURFACES = {
  get_ranked_open_jobs: { sel: (c) => `SELECT ${c} FROM public.get_ranked_open_jobs()`, sig: "get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)" },
  get_open_jobs_for_map: { sel: (c) => `SELECT ${c} FROM public.get_open_jobs_for_map()`, sig: "get_open_jobs_for_map()" },
};
const LIVE = { acl: ["anon=X/postgres", "authenticated=X/postgres", "postgres=X/postgres", "service_role=X/postgres"], proconfig: ["TimeZone=America/Chicago", "search_path=public"] };
async function cols(name) {
  return (await db.query(`SELECT a.n || ' ' || format_type(a.t, NULL) c FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[], p.proallargtypes) WITH ORDINALITY a(n, m, t, i)
     WHERE p.proname = $1 AND a.m = 't' ORDER BY a.i`, [name])).rows.map((r) => r.c);
}
async function shape(name) {
  const r = (await db.query(`SELECT p.oid::regprocedure::text sig, p.proacl::text[] acl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_arguments(p.oid) args, obj_description(p.oid, 'pg_proc') cmt
    FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`, [name])).rows;
  return r.length === 1 ? r[0] : null;
}
async function titlesAs(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try { return (await db.query(sql)).rows.map((r) => r.title).sort(); } finally { await db.exec("RESET ROLE"); }
}
const before = {};
for (const [n] of Object.entries(SURFACES)) before[n] = { cols: await cols(n), shape: await shape(n) };

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

const WANT = ["oneday_future", "undated", "window_future", "window_started"];
for (const [n, s] of Object.entries(SURFACES)) {
  const c = await cols(n);
  check(`${n}: the old columns in order, plus date_window_end date last`,
    JSON.stringify(c) === JSON.stringify([...before[n].cols.filter((x) => x !== "date_window_end date"), "date_window_end date"]), `${before[n].cols.length} -> ${c.length}, last=${c.at(-1)}`);
  for (const role of ["anon", "authenticated"]) {
    const t = await titlesAs(role, s.sel("title"));
    check(`${n} (${role}): a window whose first day passed is listed until its last day; past one-day and over windows are not`,
      JSON.stringify(t) === JSON.stringify(WANT), JSON.stringify(t));
  }
  let ends = {};
  try {
    await db.exec("SET ROLE anon");
    ends = Object.fromEntries((await db.query(`${s.sel(`title, date_window_end - ${today} AS d`)}`)).rows.map((r) => [r.title, r.d]));
  } catch (e) { ends = { error: e.message.slice(0, 60) }; } finally { await db.exec("RESET ROLE"); }
  check(`${n}: date_window_end is returned (+3 / +6 for windows, null for a one-day job)`,
    ends.window_started === 3 && ends.window_future === 6 && ends.oneday_future === null, JSON.stringify(ends));
  const sh = await shape(n);
  check(`${n}: one function, same signature and arguments`, sh?.sig === s.sig && sh?.args === before[n].shape.args, sh?.sig);
  check(`${n}: SECURITY DEFINER, STABLE, search_path + TimeZone as live`, sh?.prosecdef === true && sh?.provolatile === "s" && JSON.stringify([...(sh?.proconfig ?? [])].sort()) === JSON.stringify(LIVE.proconfig));
  check(`${n}: EXECUTE exactly as live (no PUBLIC)`, JSON.stringify([...(sh?.acl ?? [])].sort()) === JSON.stringify(LIVE.acl), JSON.stringify(sh?.acl));
  check(`${n}: COMMENT unchanged`, sh?.cmt === before[n].shape.cmt, String(sh?.cmt).slice(0, 30));
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
