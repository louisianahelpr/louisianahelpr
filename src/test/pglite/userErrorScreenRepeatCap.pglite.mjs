#!/usr/bin/env node
/**
 * PGlite proof for 20260923092838_user_error_screen_repeat_cap_and_client_seed_tag
 * (docs/OPEN.md Q96, Q97) and 20260923094457_error_logs_client_identity_and_throttle
 * (Q106, Q98).
 *
 *   node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs       # RED: neither fix
 *   NEW_MIGRATION=skip-q106 node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs  # RED: Q96/Q97 only
 *   NEW_MIGRATION=skip-q113 node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs  # RED: no Q113 fix
 *   NEW_MIGRATION=skip-q122 node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs  # RED: drop column still `kind`
 *   MUTATE=q122-rename-only node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs  # RED: renamed, bodies not replaced
 *   MUTATE=no-stamp node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs          # RED: Q106 stamp line removed
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture schema is the Q39 proof's
 * (userErrorScreenLedger.pglite.mjs).
 *
 * Applies the ledger chain + 20260923085642 (Q39), then the new migration 3x
 * (replay-safe), and proves:
 *   Q96 - one account hitting a KNOWN screen 30x in an hour bumps the item at
 *         most 5 times; every row is still in error_logs; a second account
 *         still bumps it (per account); varying an id in the screen does not
 *         evade it; guests share 20; the close rule still says "failing" while
 *         the capped account keeps hitting it; an hour later it bumps again.
 *   Q97 - a real (non-seed) account's client row tagged seed:"true" or with a
 *         '-seed' source is NOT hidden; a seed profile still is; server rows
 *         keep the tag (error_log_is_seed true).
 *   Q106 - an AUTHENTICATED insert with user_id NULL (or someone else's id) is
 *         stamped with the caller's auth.uid(), so its repeats are capped at 5
 *         (the account cap), not 20 (the guest cap), and spend no guest budget.
 *   Q98  - (fixture sizes, 2026-09-23) a client account's 70 inserts in a minute store 60 (one by one AND
 *         in one batch INSERT); guests together store 120; a back-dated
 *         created_at is re-stamped; server rows are never throttled.
 *   Q114 - error_logs has RLS ON and the LIVE anyone_can_insert_errors policy
 *         (copied from prod pg_policies 2026-09-23), so the Q106 cases prove the
 *         BEFORE stamp runs before WITH CHECK: authenticated NULL -> stored and
 *         stamped; authenticated claiming another uid -> stored, stamped to the
 *         caller; anon with a non-null user_id -> REFUSED. MUTATE=no-stamp
 *         removes the stamp line and the other-uid case is then refused.
 *   Q113 - (20260923100454) one guest fingerprint stores at most 20 a minute and
 *         cannot block a different guest error; guests together store 300; every
 *         drop is counted per kind in error_log_throttle_drops; the recorder
 *         never raises; check_error_log_throttle opens a ledger item on drops in
 *         >= 2 of the last 10 complete minutes (once per 15 min); the close rule
 *         is NULL before a complete minute after the occurrence, failing while
 *         the latest complete minute dropped, cleared on a clean one, and
 *         ops_alert_verify closes it only then.
 *   Q122 - (20260923105333) the drop column is drop_kind (no `kind` column, which
 *         made every `{ kind: ... }` test literal a row of this table), its CHECK
 *         is on drop_kind, and every Q113 count above still lands under the new
 *         name. MUTATE=q122-rename-only applies only the rename: the recorder
 *         then swallows its own error and every drop count is 0.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const CHAIN = [
  "20260923043402_ops_alert_ledger.sql",
  "20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql",
  "20260923052520_seed_alerts_go_to_the_digest.sql",
  "20260923055631_push_token_health_monitor.sql",
  "20260923085642_user_error_screens_reach_the_ledger.sql",
  "20260923090536_db_saturation_monitor.sql",
];
const Q96 = "20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql";
const Q106 = "20260923094457_error_logs_client_identity_and_throttle.sql";
const Q113 = "20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql";
const Q122 = "20260923105333_throttle_drops_kind_rename.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const REAL2 = "aaaaaaaa-0000-0000-0000-000000000002";
const SEED = "bbbbbbbb-0000-0000-0000-000000000003";
const THR1 = "dddddddd-0000-0000-0000-000000000004";
const THR2 = "dddddddd-0000-0000-0000-000000000005";
const THR3 = "dddddddd-0000-0000-0000-000000000006";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text DEFAULT 'error', message text, url text, stack text, user_id uuid, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE INDEX idx_error_logs_user ON public.error_logs USING btree (user_id, created_at DESC);
-- Q114: RLS and the insert policy exactly as live (pg_policies, prod 2026-09-23).
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY anyone_can_insert_errors ON public.error_logs AS PERMISSIVE FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))));
CREATE FUNCTION public.stamp_error_log_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', coalesce(NEW.tags->'origin', '"server"'), true);
  ELSE
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', '"client"', true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
CREATE TABLE public.jobs (id uuid DEFAULT gen_random_uuid(), stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text, platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text, status text, error_message text, created_at timestamptz DEFAULT now());
CREATE TABLE public.email_send_log (recipient_email text, status text, template_name text, created_at timestamptz);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${REAL2}', false), ('${SEED}', true),
  ('${THR1}', false), ('${THR2}', false), ('${THR3}', false);
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}
const MODE = process.env.NEW_MIGRATION ?? "";
const NEWS = MODE === "skip" ? [] : MODE === "skip-q106" ? [Q96] : MODE === "skip-q113" ? [Q96, Q106] : MODE === "skip-q122" ? [Q96, Q106, Q113] : [Q96, Q106, Q113, Q122];
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against a partly UNFIXED chain (expect FAILs)`);
for (const f of NEWS) {
  for (let i = 1; i <= 3; i++) {
    try {
      let sql = mig(f);
      // MUTATE=q122-rename-only: the column rename without the function bodies that name it.
      if (f === Q122 && process.env.MUTATE === "q122-rename-only") sql = sql.slice(0, sql.indexOf("-- ── 2."));
      await db.exec(sql);
      check(`apply ${f.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${f.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

// MUTATE=no-stamp: the newest stamp_error_log_origin with its Q106 line removed.
if (process.env.MUTATE === "no-stamp") {
  const src = mig(Q106);
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.stamp_error_log_origin()");
  const end = src.indexOf("$function$;", start) + "$function$;".length;
  const body = src.slice(start, end);
  const cut = body.replace("NEW.user_id := auth.uid();", "NULL;");
  if (cut === body) throw new Error("MUTATE=no-stamp: stamp line not found");
  await db.exec(cut);
  console.log("MUTATE=no-stamp: stamp_error_log_origin no longer sets user_id (expect FAILs)");
}

// A client insert, as PostgREST makes it: a signed-in session is role
// `authenticated` with its JWT sub; a guest is role `anon` with none. `claim`
// is the user_id the request body carries (default: the caller's own id).
const asClient = async (sub, fn) => {
  await db.exec(`SET ROLE ${sub ? "authenticated" : "anon"}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const ins = async (uid, tags, msg, claim = uid) =>
  asClient(uid, () =>
    db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags) VALUES ($1, 'warning', $2, $3::jsonb)`,
      [claim, msg, JSON.stringify(tags)]));
// Same insert, but a refusal is returned, not thrown (Q114: RLS is ON).
const tryIns = async (uid, tags, msg, claim = uid) => {
  try {
    await ins(uid, tags, msg, claim);
    return null;
  } catch (e) {
    return e.message;
  }
};
const item = async (like) =>
  (await q(`SELECT id, count::int n, status, sample_ref FROM public.ops_alert_ledger
             WHERE source_kind = 'user-error-screen' AND title LIKE $1 AND NOT coalesce((sample_ref->>'overflow')::boolean, false)`, [like]))[0];
const rows = async (screenLike, uid) =>
  (await q(`SELECT count(*)::int n FROM public.error_logs
             WHERE tags->>'screen' LIKE $1 AND user_id IS NOT DISTINCT FROM $2::uuid`, [screenLike, uid]))[0].n;
const tag = (screen, extra = {}) => ({ source: "ErrorState", kind: "user-error-screen", screen, ...extra });
const cond = async (ref) =>
  (await q(`SELECT public.ops_alert_condition('user-error-screen', $1::jsonb, now(), false) c`, [JSON.stringify(ref)]))[0].c;

// ── Q96: repeats capped per account per fingerprint per hour ────────────────
for (let i = 0; i < 30; i++) await ins(REAL, tag("/loop"), "Error screen shown: looped");
let it = await item("/loop%");
check("Q96: one account, one screen, 30 hits in an hour -> ledger bumped at most 5 times", it?.n === 5, `count=${it?.n}`);
check("Q96: ... and all 30 rows are still stored in error_logs", (await rows("/loop", REAL)) === 30);
check("Q96: the item is open", it?.status === "open", it?.status);

await ins(REAL2, tag("/loop"), "Error screen shown: looped");
it = await item("/loop%");
check("Q96: a SECOND account hitting the same screen still bumps it (the cap is per account)", it?.n === 6, `count=${it?.n}`);

await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '30 minutes' WHERE tags->>'screen' = '/loop'`);
await ins(REAL, tag("/loop"), "Error screen shown: looped");
check("Q96: the close rule still says FAILING while the capped account keeps hitting it", (await cond(it.sample_ref)) === true);
check("Q96: ... that capped hit did not bump", (await item("/loop%"))?.n === 6, `count=${(await item("/loop%"))?.n}`);

await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '2 hours' WHERE tags->>'screen' = '/loop'`);
await ins(REAL, tag("/loop"), "Error screen shown: looped");
check("Q96: an hour later the same account bumps it again (a window, not a ban)", (await item("/loop%"))?.n === 7,
  `count=${(await item("/loop%"))?.n}`);

for (let i = 0; i < 12; i++) {
  await ins(REAL2, tag(`/user/cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`), "Error screen shown: profile");
}
it = await item("/user/<id>%");
check("Q96: varying the id in the screen is the same fingerprint, still capped at 5", it?.n === 5, `count=${it?.n}`);

// 40 hits in two batches a minute apart: one guest fingerprint stores at most
// 20 a minute (Q113), and this is about the hourly ledger budget.
for (let i = 0; i < 20; i++) await ins(null, tag("/guest", { source: "ErrorBoundary" }), "guest crash");
await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '2 minutes' WHERE tags->>'screen' = '/guest'`);
for (let i = 0; i < 20; i++) await ins(null, tag("/guest", { source: "ErrorBoundary" }), "guest crash");
it = await item("/guest%");
check("Q96: guests (no account) share ONE budget of 20 per screen per hour", it?.n === 20, `count=${it?.n}`);
check("Q96: ... all 40 guest rows stored", (await rows("/guest", null)) === 40);

// ── Q97: a client's seed tag is not trusted ─────────────────────────────────
await ins(REAL, tag("/tagged", { seed: "true" }), "Error screen shown: tagged");
check("Q97: a real account's client row tagged seed:'true' still reaches the ledger", !!(await item("/tagged%")));
await ins(REAL, tag("/suffix", { source: "ErrorState-seed" }), "Error screen shown: suffix");
check("Q97: a real account's client row with a '-seed' source still reaches the ledger", !!(await item("/suffix%")));
await ins(null, tag("/guesttag", { seed: "true" }), "Error screen shown: guest tagged");
check("Q97: a guest's seed-tagged row is real (no profile says otherwise)", !!(await item("/guesttag%")));
await ins(SEED, tag("/seedprofile"), "Error screen shown: seed profile");
check("Q97: a seed PROFILE is still excluded (seed comes from profiles.is_seed)", !(await item("/seedprofile%")));
const [{ s1, s2, c1 }] = await q(`SELECT public.error_log_is_seed('{"seed":"true","origin":"server"}') s1,
  public.error_log_is_seed('{"source":"detect_stuck_payments-seed"}') s2,
  public.error_log_is_seed('{"seed":"true","origin":"client"}') c1`);
check("Q97: server rows keep the tag (seed:true / '-seed' source -> seed)", s1 === true && s2 === true, JSON.stringify({ s1, s2 }));
check("Q97: a client row's seed tag is ignored by error_log_is_seed", c1 === false, JSON.stringify({ c1 }));

// ── Q106: a signed-in client cannot log as a guest ──────────────────────────
let q106err = null;
for (let i = 0; i < 30; i++) q106err ??= await tryIns(THR3, tag("/q106"), "Error screen shown: q106", null);
check("Q114: under RLS, an authenticated insert with user_id NULL PASSES WITH CHECK", q106err === null, q106err ?? "");
check("Q106: an authenticated insert with user_id NULL is stored with the caller's id",
  (await rows("/q106", THR3)) === 30 && (await rows("/q106", null)) === 0,
  `mine=${await rows("/q106", THR3)} guest=${await rows("/q106", null)}`);
it = await item("/q106%");
check("Q106: ... so its repeats are capped at 5 (account cap), not 20 (guest cap)", it?.n === 5, `count=${it?.n}`);
check("Q106: ... and the ledger item is not marked as a guest's", it?.sample_ref?.signed_in === true, JSON.stringify(it?.sample_ref));
const otherErr = await tryIns(THR3, tag("/q106b"), "Error screen shown: q106b", REAL);
check("Q114: under RLS, an authenticated insert claiming ANOTHER uid PASSES WITH CHECK (the BEFORE stamp ran first)",
  otherErr === null, otherErr ?? "");
check("Q106: an authenticated insert claiming ANOTHER account's id is stamped with the caller's",
  (await rows("/q106b", THR3)) === 1 && (await rows("/q106b", REAL)) === 0);
const anonErr = await tryIns(null, tag("/q114anon"), "Error screen shown: q114 anon", REAL);
check("Q114: an ANON insert carrying a non-null user_id is REFUSED by anyone_can_insert_errors",
  /row-level security/i.test(anonErr ?? "") && (await rows("/q114anon", REAL)) === 0, anonErr ?? "accepted");
await ins(null, tag("/q106c"), "Error screen shown: q106c");
check("Q106: a guest (anon) insert is still stored as a guest row", (await rows("/q106c", null)) === 1);

// ── Q98: client rows are throttled per minute; server rows are not ──────────
const clientRows = async (uid) =>
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE user_id IS NOT DISTINCT FROM $1::uuid
             AND tags->>'origin' = 'client' AND created_at > now() - interval '1 minute'`, [uid]))[0].n;
for (let i = 0; i < 70; i++) await ins(THR1, { source: "loop" }, `loop ${i}`);
check("Q98: one account's 70 client rows in a minute store only 60", (await clientRows(THR1)) === 60, `stored=${await clientRows(THR1)}`);

await asClient(THR2, () => db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags)
  SELECT $1::uuid, 'warning', 'batch ' || g, '{"source":"batch"}'::jsonb FROM generate_series(1, 70) g`, [THR2]));
check("Q98: ... and a single 70-row batch INSERT stores only 60", (await clientRows(THR2)) === 60, `stored=${await clientRows(THR2)}`);
// ── Q113: one guest fingerprint cannot fill the shared guest bucket ─────────
// A name made only of non-hex letters (g..z): ops_alert_normalise keeps it, so
// each i is its own fingerprint (digits would all collapse to '#').
const word = (i) => String.fromCharCode(103 + (i % 20)) + String.fromCharCode(103 + (Math.floor(i / 20) % 20)) +
  String.fromCharCode(103 + Math.floor(i / 400));
const hasDrops = !!(await q(`SELECT to_regclass('public.error_log_throttle_drops') t`))[0].t;
// Q122: the column the chain actually has, so NEW_MIGRATION=skip-q122 fails on the Q122 checks, not by crashing.
const dropCols = hasDrops ? (await q(`SELECT column_name c FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'error_log_throttle_drops'`)).map((r) => r.c) : [];
const K = dropCols.includes("drop_kind") ? "drop_kind" : "kind";
if (hasDrops) {
  check("Q122: error_log_throttle_drops has drop_kind and no `kind` column",
    dropCols.includes("drop_kind") && !dropCols.includes("kind"), dropCols.join(","));
  const cons = (await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE conrelid = 'public.error_log_throttle_drops'::regclass AND contype = 'c'`));
  check("Q122: its CHECK is error_log_throttle_drops_drop_kind_check on drop_kind (guest, guest_fp, account)",
    cons.length === 1 && cons[0].conname === "error_log_throttle_drops_drop_kind_check" &&
      /drop_kind/.test(cons[0].d) && ["guest", "guest_fp", "account"].every((v) => cons[0].d.includes(`'${v}'`)),
    JSON.stringify(cons));
  const [{ pk }] = await q(`SELECT pg_get_constraintdef(oid) pk FROM pg_constraint
    WHERE conrelid = 'public.error_log_throttle_drops'::regclass AND contype = 'p'`);
  check("Q122: the primary key follows the rename", pk === "PRIMARY KEY (minute, backend_pid, drop_kind)", pk);
}
const drops = async (kind) =>
  hasDrops ? (await q(`SELECT coalesce(sum(dropped), 0)::int n FROM public.error_log_throttle_drops WHERE ${K} = $1`, [kind]))[0].n : -1;
const fpRows = async (msgLike) =>
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE user_id IS NULL AND message LIKE $1
             AND created_at > now() - interval '1 minute'`, [msgLike]))[0].n;
// one flooding source: the same error with a changing id and counter, on the same page with a changing id
for (let i = 0; i < 30; i++) {
  await asClient(null, () => db.query(`INSERT INTO public.error_logs (message, url, tags) VALUES ($1, $2, '{"source":"flood"}')`,
    [`flood failed for order ${1000 + i} after ${i} ms`, `https://louisianahelpr.com/job/${crypto.randomUUID()}?x=${i}`]));
}
check("Q113: ONE guest fingerprint (message + path, ids/numbers normalised) stores at most 20 a minute",
  (await fpRows("flood failed%")) === 20, `stored=${await fpRows("flood failed%")}`);
check("Q113: ... and each of its 10 drops is counted (kind guest_fp)", (await drops("guest_fp")) === 10,
  `guest_fp=${await drops("guest_fp")}`);
await ins(null, { source: "real-guest" }, "a real guest crash while the flood runs");
check("Q113: ... while a DIFFERENT guest error is still stored", (await fpRows("a real guest crash%")) === 1);
const [{ fpTag }] = await q(`SELECT tags->>'guest_fp' "fpTag" FROM public.error_logs WHERE message LIKE 'a real guest crash%'`);
check("Q113: the fingerprint is stored on the row (tags.guest_fp)", /^[0-9a-f]{32}$/.test(fpTag ?? ""), fpTag ?? "none");
await asClient(null, () => db.query(`INSERT INTO public.error_logs (message, tags) VALUES ('forged fp', $1::jsonb)`,
  [JSON.stringify({ source: "forge", guest_fp: fpTag ?? "x" })]));
const [{ forged }] = await q(`SELECT tags->>'guest_fp' forged FROM public.error_logs WHERE message = 'forged fp'`);
check("Q113: a client cannot pick its fingerprint (tags.guest_fp is overwritten)", !!fpTag && forged !== fpTag, `${forged}`);

// guests together, all DIFFERENT fingerprints: the shared bucket
const guestBefore = await clientRows(null);
for (let i = 0; i < 330; i++) await ins(null, { source: "guest-loop" }, `guest ${word(i)}`);
check("Q98/Q113: guests together store at most 300 client rows a minute", (await clientRows(null)) === 300,
  `before=${guestBefore} after=${await clientRows(null)}`);
check("Q113: ... and every row the global cap dropped is counted (kind guest)",
  (await drops("guest")) === 330 - (300 - guestBefore), `guest=${await drops("guest")} expected=${330 - (300 - guestBefore)}`);
check("Q113: the 20 account-cap drops above are counted (kind account)", (await drops("account")) === 20, `account=${await drops("account")}`);

await asClient(THR3, () => db.query(`INSERT INTO public.error_logs (user_id, message, tags, created_at)
  VALUES ($1, 'backdated', '{"source":"bd"}'::jsonb, '2000-01-01')`, [THR3]));
const [{ bd }] = await q(`SELECT (created_at > now() - interval '1 minute') bd FROM public.error_logs WHERE message = 'backdated'`);
check("Q98: a client cannot back-date created_at out of the window", bd === true);

for (let i = 0; i < 200; i++) {
  await db.query(`INSERT INTO public.error_logs (user_id, message, tags) VALUES ($1, 'server ' || $2, '{"source":"cron-http"}')`,
    [THR1, String(i)]);
  await db.query(`INSERT INTO public.error_logs (user_id, message, tags) VALUES (NULL, 'server ' || $1, '{"source":"cron-http"}')`,
    [String(i)]);
}
const [{ srv }] = await q(`SELECT count(*)::int srv FROM public.error_logs WHERE message LIKE 'server %' AND tags->>'origin' = 'server'`);
check("Q98: server rows are never throttled (400 of 400 stored, for a capped account and for NULL)", srv === 400, `stored=${srv}`);

// ── Q113: drops are visible and sustained throttling reaches the ledger ────
const exists = async (sig) => !!(await q(`SELECT to_regprocedure($1)::text p`, [sig]))[0].p;
if (hasDrops && (await exists("public.check_error_log_throttle()"))) {
  const [{ neverRaises }] = await q(`SELECT (SELECT 1 FROM (SELECT public.record_error_log_throttle_drop('not-a-kind')) x) = 1 "neverRaises"`);
  check("Q113: recording a drop never raises (a CHECK violation is swallowed)", neverRaises === true);
  // Only the current (incomplete) minute has drops: nothing is judged yet.
  let [{ r }] = await q(`SELECT public.check_error_log_throttle() r`);
  check("Q113: drops only in the current, incomplete minute do not raise", r.raised === false && r.minutes === 0, JSON.stringify(r));
  // Sustained: drops in two of the last 10 complete minutes.
  await db.exec(`UPDATE public.error_log_throttle_drops SET minute = minute - interval '3 minutes' WHERE ${K} = 'guest';
                 UPDATE public.error_log_throttle_drops SET minute = minute - interval '2 minutes' WHERE ${K} = 'guest_fp';
                 DELETE FROM public.error_log_throttle_drops WHERE ${K} NOT IN ('guest', 'guest_fp');`);
  [{ r }] = await q(`SELECT public.check_error_log_throttle() r`);
  check("Q113: drops in 2 of the last 10 complete minutes raise", r.raised === true && r.minutes === 2, JSON.stringify(r));
  check("Q122: ... and the check reports them by kind (grouped by the renamed column)",
    !!r.by_kind && r.by_kind.guest > 0 && r.by_kind.guest_fp > 0 && Object.keys(r.by_kind).length === 2, JSON.stringify(r.by_kind));
  const led = async () => (await q(`SELECT id, status, verify_kind, verify_ref, count::int n, last_seen FROM public.ops_alert_ledger
                                     WHERE source = 'error-log-throttled'`))[0];
  let L = await led();
  check("Q113: ... as an OPEN ledger item verified by sql_condition 'error-log-throttled'",
    L?.status === "open" && L?.verify_kind === "sql_condition" && L?.verify_ref === "error-log-throttled", JSON.stringify(L));
  [{ r }] = await q(`SELECT public.check_error_log_throttle() r`);
  check("Q113: a second check inside 15 minutes writes no second row", r.raised === false && (await led())?.n === 1,
    `${JSON.stringify(r)} n=${(await led())?.n}`);
  const c = async (since) =>
    (await q(`SELECT public.ops_alert_condition('error-log-throttled', '{}'::jsonb, ${since}, false) c`))[0].c;
  check("Q113: close rule is NULL (cannot tell) before a complete minute after the occurrence", (await c("now()")) === null);
  await db.exec(`INSERT INTO public.error_log_throttle_drops (minute, backend_pid, ${K}, dropped)
                 VALUES (date_trunc('minute', now()) - interval '1 minute', 1, 'guest', 3)`);
  check("Q113: close rule says FAILING while the latest complete minute dropped rows",
    (await c("now() - interval '10 minutes'")) === true);
  await db.exec(`UPDATE public.ops_alert_ledger SET last_seen = now() - interval '10 minutes' WHERE source = 'error-log-throttled'`);
  await q(`SELECT public.ops_alert_verify()`);
  check("Q113: ops_alert_verify keeps it open while throttling continues", (await led())?.status === "open", (await led())?.status);
  await db.exec(`DELETE FROM public.error_log_throttle_drops WHERE minute = date_trunc('minute', now()) - interval '1 minute'`);
  check("Q113: close rule says CLEARED on a clean complete minute after the occurrence",
    (await c("now() - interval '10 minutes'")) === false);
  await q(`SELECT public.ops_alert_verify()`);
  L = await led();
  check("Q113: ops_alert_verify closes it on the clean minute", L?.status === "closed", L?.status);
} else {
  check("Q113: check_error_log_throttle() and error_log_throttle_drops exist", false, "not in this chain");
}

// ── privileges ──────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const fn of [
    "public.error_log_is_seed(jsonb)",
    "public.user_error_screen_is_real(uuid, jsonb)",
    "public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz)",
    ...(NEWS.includes(Q106) ? ["public.throttle_client_error_log()", "public.stamp_error_log_origin()"] : []),
    ...(NEWS.includes(Q113) ? ["public.record_error_log_throttle_drop(text)", "public.check_error_log_throttle()"] : []),
  ]) {
    const [{ ok }] = await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
  if (hasDrops) {
    const [{ t }] = await q(`SELECT has_table_privilege('${role}', 'public.error_log_throttle_drops', 'SELECT,INSERT,UPDATE,DELETE') t`);
    check(`${role} has no privilege on error_log_throttle_drops`, t === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
