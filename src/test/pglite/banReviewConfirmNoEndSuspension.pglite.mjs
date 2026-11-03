#!/usr/bin/env node
/**
 * PGlite proof for 20261103230932_ban_review_confirm_keeps_a_no_end_suspension.sql (docs/OPEN.md Q1415 (f3)).
 *
 *   node src/test/pglite/banReviewConfirmNoEndSuspension.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/banReviewConfirmNoEndSuspension.pglite.mjs   # RED: the live state
 *
 * Every function is its NEWEST definition before the migration under test; the confirm is checked by md5(prosrc)
 * against prod (read 2026-11-03) or the proof refuses to run, and so are the two settlement triggers attached as on prod.
 * A standing strike rung is a deferred_rungs entry whose basis is a live user_violations row, as the ladder writes it.
 * Stubbed, and said so: the settlement functions (a temporary judgment never settles; their own proofs cover them).
 *
 *   N1  a review suspension with NO end is never replaced by a dated rung (the f3 defect)
 *   N2  a rung with no end outlasts the review's dated suspension
 *   N3  between two dated suspensions the later end applies, whichever side carries it
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261103230932_ban_review_confirm_keeps_a_no_end_suspension.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const FIXED = process.env.NEW_MIGRATION !== "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** md5(prosrc) on prod, read 2026-11-03 (read-only MCP SELECT). */
const LIVE_MD5 = {
  admin_confirm_ban_settlement: "288fe7775e2e72e9293345fc013febfb",
  settle_one_off_jobs_on_permanent_ban: "764d9d697a6829c788fe65bf73753a9e",
  end_series_on_permanent_ban: "3e4b2d55ce781bbcdedfe047d7bd4582",
};
const LOAD = ["is_server_context", "has_role", "ban_standing_rank", "ban_review_standing_rung", "ban_review_retained_floor",
  "refuse_unban_during_ban_review", "settle_one_off_jobs_on_permanent_ban", "end_series_on_permanent_ban", "admin_confirm_ban_settlement"];

function newestStatement(name, files) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  let found = null;
  for (const f of files) {
    const sql = read(f);
    for (const m of sql.matchAll(head)) {
      const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(m.index))[1];
      const open = sql.indexOf(tag, m.index);
      const close = sql.indexOf(tag, open + tag.length);
      found = { file: f, stmt: `${sql.slice(m.index, close + tag.length)};` };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}
const before = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f) && f < UNDER_TEST).sort();

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const T = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const days = (n) => new Date(Date.now() + n * 86400e3).toISOString();

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, ban_type text NOT NULL DEFAULT 'temporary',
  reason text NOT NULL, banned_by uuid NOT NULL, expires_at timestamptz, created_at timestamptz DEFAULT now(), is_active boolean DEFAULT true);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, violation_type text NOT NULL,
  description text, job_id uuid, reported_by uuid, action_taken text NOT NULL DEFAULT 'warning', created_at timestamptz DEFAULT now());
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, matched_on text NOT NULL,
  review_state text NOT NULL DEFAULT 'open', original_ban_status text, original_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, alerted_at timestamptz, deferred_ban_status text, deferred_suspended_until timestamptz, deferred_at timestamptz,
  deferred_rungs jsonb NOT NULL DEFAULT '[]'::jsonb);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_id text, target_type text, details jsonb);
CREATE TABLE public.retained_bans (id uuid PRIMARY KEY, email_sha256 text NOT NULL DEFAULT 'x', ban_status text NOT NULL, ban_type text,
  reason text NOT NULL DEFAULT 'r', expires_at timestamptz, retained_at timestamptz NOT NULL DEFAULT now(), reapplied_at timestamptz);
CREATE TABLE public.ban_evasion_matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, matched_on text, retained_ban_id uuid,
  original_ban_status text, original_expires_at timestamptz, auto_banned boolean NOT NULL DEFAULT false, resolved boolean DEFAULT false,
  cleared_at timestamptz, created_at timestamptz DEFAULT now(), auto_banned_at timestamptz);
CREATE TABLE public.payout_holds (helper_id uuid, held_by uuid, denied_by uuid, reason text);
CREATE TABLE public.settle_calls (fn text, user_id uuid, as_of text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.settle_one_off_jobs_for_banned_account(p uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.settle_calls (fn, user_id, as_of) VALUES ('settle', p, NULLIF(current_setting('app.ban_settlement_as_of', true), ''));
  RETURN jsonb_build_object('settled_jobs', 0);
END $$;
CREATE FUNCTION public.end_series_for_banned_account(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.settle_calls (fn, user_id, as_of) VALUES ('series', p, NULLIF(current_setting('app.ban_settlement_as_of', true), ''));
END $$;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
for (const name of LOAD) await db.exec(newestStatement(name, before).stmt);
await db.exec(`
CREATE TRIGGER trg_refuse_unban_during_ban_review BEFORE UPDATE OF ban_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.refuse_unban_during_ban_review();
CREATE TRIGGER trg_series_end_on_permanent_ban AFTER UPDATE OF ban_status ON public.profiles FOR EACH ROW
  WHEN (new.ban_status = ANY (ARRAY['banned'::text, 'permanently_banned'::text]) AND old.ban_status IS DISTINCT FROM new.ban_status)
  EXECUTE FUNCTION public.end_series_on_permanent_ban();
CREATE TRIGGER trg_settle_one_off_jobs_on_permanent_ban AFTER UPDATE OF ban_status ON public.profiles FOR EACH ROW
  WHEN (new.ban_status = ANY (ARRAY['banned'::text, 'permanently_banned'::text]) AND old.ban_status IS DISTINCT FROM new.ban_status)
  EXECUTE FUNCTION public.settle_one_off_jobs_on_permanent_ban();
`);
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [name])).rows[0]?.m;
  if (got !== want) {
    console.log(`REFUSING TO RUN: public.${name} md5 ${got} != prod ${want}`);
    process.exit(1);
  }
}
if (FIXED) for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));
console.log(FIXED ? `applied ${UNDER_TEST} 3x` : "the live state (migration skipped)");

/** A card review opened 2 h ago carrying a suspension until `until` (null: no end) and a standing rung until `rungUntil`. */
async function seed(u, until, rungUntil) {
  await db.query(`INSERT INTO public.profiles (user_id, ban_status) VALUES ($1, 'banned')`, [u]);
  const v = (await db.query(`INSERT INTO public.user_violations (user_id, violation_type, action_taken) VALUES ($1, 'job_denial', 'strike') RETURNING id`, [u])).rows[0].id;
  const rung = [{ ban_status: "temp_banned", suspended_until: rungUntil, basis: [v] }];
  await db.query(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, original_ban_status, original_expires_at, created_at, deferred_rungs)
                  VALUES ($1, 'card', 'temp_banned', $2, $3, $4::jsonb)`, [u, until, ago(2), JSON.stringify(rung)]);
}
async function confirm(u) {
  await db.exec(`SELECT set_config('request.uid', '${ADMIN}', false), set_config('request.role', 'authenticated', false);`);
  try {
    await db.query(`SELECT public.admin_confirm_ban_settlement($1)`, [u]);
  } finally {
    await db.exec(`SELECT set_config('request.uid', '', false), set_config('request.role', '', false);`);
  }
  return (await db.query(`SELECT ban_status, auto_suspended_until AS until FROM public.profiles WHERE user_id = $1`, [u])).rows[0];
}
const near = (d, iso) => d instanceof Date && Math.abs(d.getTime() - new Date(iso).getTime()) < 1000;
const D7 = days(7), D30 = days(30);

{
  const p = await confirm((await seed(T(1), null, D30), T(1)));
  check("N1 a no-end review suspension is never replaced by a dated rung", p?.ban_status === "temp_banned" && p?.until === null, JSON.stringify(p));
}
{
  const p = await confirm((await seed(T(2), D7, null), T(2)));
  check("N2 a rung with no end outlasts the review's dated suspension", p?.ban_status === "temp_banned" && p?.until === null, JSON.stringify(p));
}
{
  const a = await confirm((await seed(T(3), D7, D30), T(3)));
  const b = await confirm((await seed(T(4), D30, D7), T(4)));
  check("N3 between two dated suspensions the later end applies, whichever side carries it",
    a?.ban_status === "temp_banned" && near(a.until, D30) && b?.ban_status === "temp_banned" && near(b.until, D30), JSON.stringify({ a, b }));
}

console.log(failures ? `\n${failures} FAILED (${FIXED ? "with the fix" : "the live state"})` : `\nALL PASS (${FIXED ? "applied 3x" : "the live state"})`);
process.exit(failures ? 1 : 0);
