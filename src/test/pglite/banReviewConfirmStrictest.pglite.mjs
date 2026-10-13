#!/usr/bin/env node
/**
 * PGlite proof for 20261013001155_ban_review_confirm_keeps_strictest_retained_judgment
 * (docs/OPEN.md Q1415 (f)).
 *
 *   node src/test/pglite/banReviewConfirmStrictest.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/banReviewConfirmStrictest.pglite.mjs   # RED: the live state
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Every function
 * is its NEWEST definition in the migrations before the one under test; the
 * confirm, the lift and the rank are checked by md5(prosrc) against prod (read
 * 2026-10-12), or the proof refuses to run. Trigger as live:
 * trg_refuse_unban_during_ban_review (it pins the profile at 'banned' while a
 * review is open, so the profile is seeded 'banned' as on prod). Stubbed, and
 * said so: the job settlement and series ending a confirmed ban runs (no job
 * exists here).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const FIXED = process.env.NEW_MIGRATION !== "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** md5(prosrc) on prod, read 2026-10-12. */
const LIVE_MD5 = {
  ban_standing_rank: "8a85ce1ecb251aa34920246a010433b6",
  admin_confirm_ban_settlement: "47b6bb30ae91bbd3c68ab0394b656a81",
  lift_ban_settlement_review: "d5838f0493ffe105f5bee0be86e4f477",
};
const LOAD = ["is_server_context", "has_role", "ban_standing_rank", "ban_review_standing_rung", "refuse_unban_during_ban_review",
  "lift_ban_settlement_review", "admin_confirm_ban_settlement"];

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
  cleared_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.payout_holds (helper_id uuid, held_by uuid, denied_by uuid, reason text);
CREATE FUNCTION public.settle_one_off_jobs_for_banned_account(p uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.end_series_for_banned_account(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
const from = {};
for (const name of LOAD) {
  const s = newestStatement(name, before);
  from[name] = s.file;
  await db.exec(s.stmt);
}
await db.exec(`CREATE TRIGGER trg_refuse_unban_during_ban_review BEFORE UPDATE OF ban_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.refuse_unban_during_ban_review();`);
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [name])).rows[0]?.m;
  if (got !== want) {
    console.log(`REFUSING TO RUN: public.${name} md5 ${got} != prod ${want} (read from ${from[name]})`);
    process.exit(1);
  }
}
check("fixture: the confirm, the lift and the rank are prod's code (md5 of prosrc)", true);

if (FIXED) for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));

async function asAdmin(sql) {
  await db.exec(`SELECT set_config('request.uid', '${ADMIN}', false), set_config('request.role', 'authenticated', false);`);
  try { return { ok: true, rows: (await db.query(sql)).rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec(`SELECT set_config('request.uid', '', false), set_config('request.role', '', false);`); }
}
const confirm = (u) => asAdmin(`SELECT public.admin_confirm_ban_settlement('${u}') AS v`);
const lift = (u) => asAdmin(`SELECT public.lift_ban_settlement_review('${u}', '${ADMIN}', 'active') AS v`);
const prof = async (u) => (await db.query(`SELECT ban_status, auto_suspended_until FROM public.profiles WHERE user_id = $1`, [u])).rows[0];
const selfBan = async (u) => (await db.query(`SELECT ban_type, expires_at FROM public.user_bans WHERE user_id = $1 AND banned_by = $1 AND is_active`, [u])).rows[0];
const days = (n) => new Date(Date.now() + n * 86400e3).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/** A card review opened `openedHoursAgo` ago carrying `status` until `until`; the profile is pinned 'banned'. */
async function seedReview(u, status, until, openedHoursAgo = 2) {
  await db.query(`INSERT INTO public.profiles (user_id, ban_status) VALUES ($1, 'banned')`, [u]);
  await db.query(`INSERT INTO public.ban_settlement_queue (user_id, matched_on, original_ban_status, original_expires_at, created_at) VALUES ($1, 'card', $2, $3, $4)`,
    [u, status, until, ago(openedHoursAgo)]);
}
/** A retained judgment `st` (until `ex`) matched on `on`, recorded `createdHoursAgo` ago; its retained row live unless `retained` says otherwise. */
async function seedMatch(u, rid, on, st, ex, { createdHoursAgo = 1, auto = true, cleared = false, retained = "live", reappliedHoursAgo = null } = {}) {
  if (retained !== "gone") {
    await db.query(`INSERT INTO public.retained_bans (id, ban_status, expires_at, reapplied_at) VALUES ($1, $2, $3, $4)`,
      [rid, st, retained === "expired" ? ago(1) : ex, reappliedHoursAgo === null ? null : ago(reappliedHoursAgo)]);
  }
  await db.query(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, retained_ban_id, original_ban_status, original_expires_at, auto_banned, cleared_at, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [u, on, rid, st, ex, auto, cleared ? ago(0.5) : null, ago(createdHoursAgo)]);
}

// C1 — a permanent identity judgment applied during a temp card review survives the confirm.
{
  const u = T(1);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(1), "identity", "permanently_banned", null);
  await db.query(`INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by) VALUES ($1, 'permanently_banned', 'linked', $1)`, [u]);
  const r = await confirm(u);
  check("C1 confirm keeps a stricter identity judgment from the review (permanently_banned)", r.ok && (await prof(u))?.ban_status === "permanently_banned", r.err ?? JSON.stringify(await prof(u)));
  const b = await selfBan(u);
  check("C1 ... and the self-issued ban row is not rewritten to a suspension", b?.ban_type === "permanently_banned" && b?.expires_at === null, JSON.stringify(b));
}
// C2 — two suspensions: the later end.
{
  const u = T(2);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(2), "phone", "temp_banned", days(30));
  await confirm(u);
  const p = await prof(u);
  check("C2 between two suspensions the later end applies", p?.ban_status === "temp_banned" && new Date(p.auto_suspended_until).getTime() > Date.now() + 20 * 86400e3, JSON.stringify(p));
}
// C3 — a stale match from before the review, whose retained row is gone (an unban released it), does not count.
{
  const u = T(3);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(3), "phone", "permanently_banned", null, { createdHoursAgo: 24 * 90, retained: "gone" });
  await confirm(u);
  check("C3 a stale pre-review match with no retained row does not harden the confirm", (await prof(u))?.ban_status === "temp_banned", JSON.stringify(await prof(u)));
}
// C4 — a pre-review match whose retained row is live but was NOT re-applied since does not count; one re-applied since does.
{
  const u = T(4);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(4), "email", "permanently_banned", null, { createdHoursAgo: 24 * 30, reappliedHoursAgo: 24 * 30 });
  await confirm(u);
  check("C4a an old match never re-applied during the review does not count", (await prof(u))?.ban_status === "temp_banned", JSON.stringify(await prof(u)));
  const v = T(5);
  await seedReview(v, "temp_banned", days(7));
  await seedMatch(v, R(5), "phone", "permanently_banned", null, { createdHoursAgo: 24 * 30, reappliedHoursAgo: 1 });
  await confirm(v);
  check("C4b an older doubt-check row re-applied during the review counts", (await prof(v))?.ban_status === "permanently_banned", JSON.stringify(await prof(v)));
}
// C5 — no-end suspensions: a match with no end beats the review's dated end; the order of rows never matters.
{
  const u = T(6);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(6), "phone", "temp_banned", null);
  await seedMatch(u, R(7), "email", "temp_banned", days(3));
  await confirm(u);
  const p = await prof(u);
  check("C5 a suspension with no end outlasts every dated one, whatever the order", p?.ban_status === "temp_banned" && p?.auto_suspended_until === null, JSON.stringify(p));
}
// C6 — a spent suspension, a cleared match and a never-applied match do not count.
{
  const u = T(7);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(8), "phone", "temp_banned", ago(5));
  await seedMatch(u, R(9), "phone", "permanently_banned", null, { cleared: true });
  await seedMatch(u, R(10), "email", "permanently_banned", null, { auto: false });
  await confirm(u);
  const p = await prof(u);
  check("C6 spent, cleared and never-applied matches do not count", p?.ban_status === "temp_banned" && new Date(p.auto_suspended_until).getTime() < Date.now() + 8 * 86400e3, JSON.stringify(p));
}
// L1 — lifting the CARD match keeps an identity judgment applied during the review.
{
  const u = T(8);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(11), "card", "temp_banned", days(7));
  await seedMatch(u, R(12), "identity", "permanently_banned", null);
  const r = await lift(u);
  check("L1 a lift keeps an identity judgment from the review (the card match is cleared first)", r.ok && (await prof(u))?.ban_status === "permanently_banned", r.err ?? JSON.stringify(await prof(u)));
}
// L2 — control: with only the card match, a lift unbans as before.
{
  const u = T(9);
  await seedReview(u, "temp_banned", days(7));
  await seedMatch(u, R(13), "card", "temp_banned", days(7));
  const r = await lift(u);
  check("L2 control: only the card match -> the lift unbans to 'active'", r.ok && (await prof(u))?.ban_status === "active", r.err ?? JSON.stringify(await prof(u)));
}

console.log(failures ? `\n${failures} FAILED (${FIXED ? "with the fix" : "the live state"})` : `\nALL PASS (${FIXED ? "applied 3x" : "the live state"})`);
process.exit(failures ? 1 : 0);
