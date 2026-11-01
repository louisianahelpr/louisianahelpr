#!/usr/bin/env node
/**
 * PGlite proof for 20261101031241_declutter_check_sweep (LEAD-CHECK-SWEEP, lead 10-31; owner rule: "everyday items
 * must never be held just because a check didn't run"). The fail-safe holds an unchecked listing only after the
 * server sweep's check has FAILED 3 times (or a check flagged it); the sweep's claim picks live listings with no
 * check (never test data, never one an admin approved since it went live), counts each try before it runs, and
 * resets the count when a check is recorded or an edit clears it.
 *
 *   node src/test/pglite/declutterCheckSweep.pglite.mjs                    # AFTER: both migrations applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCheckSweep.pglite.mjs # RED: the definitions before it
 *   FOLLOWUP=skip node src/test/pglite/declutterCheckSweep.pglite.mjs      # RED for S20-S29: the sweep without
 *                                                                          # 20261101042045 (B56-SWEEP-FOLLOWUPS)
 *
 * Baseline = the newest repo (= effective prod) definitions before it, 20261031152545 (publish, record_ai_check,
 * hold_unchecked_listings), on the prod-shaped stubs of declutterCheckAfterPost.pglite.mjs. The new migration then
 * runs verbatim on top, three times. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261101031241_declutter_check_sweep.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
// B56-SWEEP-FOLLOWUPS: an edit to a never-checked listing resets its tries; admins are told of a listing on sale 45+
// minutes with no check. Applied 3x on top of the sweep unless FOLLOWUP=skip.
const FOLLOWUP = readFileSync(MIG + "20261101042045_declutter_check_sweep_followups.sql", "utf8");
const SKIP_FOLLOWUP = SKIP || process.env.FOLLOWUP === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: the definitions before the migration (expect FAILs)");

/** One CREATE FUNCTION statement out of a migration file, whatever its dollar-quote tag. */
function fnFrom(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start))[1];
  const bodyAt = sql.indexOf(tag, start) + tag.length;
  const end = sql.indexOf(tag, bodyAt) + tag.length;
  return sql.slice(start, end) + ";";
}

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const BANNED = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const B1 = "00000000-0000-4000-8000-0000000000b1";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const I = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const P = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const R = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u AND ur.role = r) $$;
  CREATE TABLE public.switch_off (key text);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.switch_off s WHERE s.key = k) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz, is_seed boolean DEFAULT false);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
  CREATE FUNCTION public.declutter_assert_member(p_selling boolean) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    RETURN auth.uid();
  END $$;
  CREATE FUNCTION public.declutter_active_strike_count(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
  CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text, other uuid);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message, p_link, p_other) $$;

  -- The live CHECK on status (20261028192719).
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, sale_mode text NOT NULL DEFAULT 'offers',
    status text NOT NULL CHECK (status = ANY (ARRAY['draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed', 'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere'])),
    title text, description text NOT NULL DEFAULT '', category text, condition_stars smallint DEFAULT 4, delivery_size text DEFAULT 'small',
    handovers text[], porch_ok boolean DEFAULT true, price_cents int DEFAULT 4000, current_price_cents int DEFAULT 4000,
    submitted_at timestamptz, live_at timestamptz, admin_approved_at timestamptz, is_seed boolean DEFAULT false,
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY, item_id uuid, storage_path text, position int);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, floor_price_cents int, ai_checked_at timestamptz,
    ai_flag_reason text, review_note text, updated_at timestamptz);
  CREATE TABLE public.declutter_tax_attestations (item_id uuid PRIMARY KEY, seller_id uuid, bought_for_personal_use boolean,
    not_in_the_business boolean, not_a_frequent_seller boolean, keeps_item_until_handover boolean, attested_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_pickup_windows (seller_id uuid);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid,
    status text NOT NULL CHECK (status = ANY (ARRAY['open', 'accepted', 'declined', 'expired', 'withdrawn', 'voided'])),
    closed_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text
    CHECK (action = ANY (ARRAY['offer', 'counter', 'accept', 'decline', 'withdraw', 'expire', 'void'])));
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobname text, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c) RETURNING 1::bigint $$;
  CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
  CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL,
    reported_id uuid NOT NULL, reason text NOT NULL, description text, status text NOT NULL DEFAULT 'new', created_at timestamptz DEFAULT now());
  -- As 20260924182505 left it (the live CHECK before this migration).
  ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
    CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text]));

  -- Review of 41771724f3 (2): a buyer reserves or pays before the check lands. Shapes as prod (20261014210518,
  -- 20261028221904 statuses, 20261004162921 payout_holds), trimmed to the columns the functions touch.
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid,
    status text NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'superseded', 'expired', 'completed', 'refunded')),
    close_reason text, closed_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, order_id uuid,
    status text NOT NULL CHECK (status IN ('in_cart', 'paid', 'missed', 'cancelled_by_seller', 'removed')),
    created_at timestamptz DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    held_by uuid, held_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
  -- Stand-in for the ledger's normaliser (lower case, as admin_alert_manual_close's prefixes are).
  CREATE FUNCTION public.ops_alert_normalise(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(t) $$;
  CREATE TABLE public.test_subjects (user_id uuid);
  CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = u) $$;

  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.profiles (user_id, ban_status) VALUES ('${SELLER}', NULL), ('${BANNED}', NULL), ('${ADMIN}', NULL), ('${B1}', NULL), ('${B2}', NULL);
  INSERT INTO public.declutter_pickup_windows VALUES ('${SELLER}'), ('${BANNED}'), ('${ADMIN}');
`);

const BEFORE = "20261031152545_declutter_check_after_post.sql";
await db.exec([fnFrom(BEFORE, "declutter_publish_item"), fnFrom(BEFORE, "declutter_record_ai_check"),
  fnFrom(BEFORE, "declutter_hold_unchecked_listings")].join("\n"));
await db.exec(`
  REVOKE ALL ON FUNCTION public.declutter_hold_unchecked_listings() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.declutter_hold_unchecked_listings() TO service_role;
`);
// The manual-close list as prod has it (newest definition, 20261031184552).
await db.exec(fnFrom("20261031184552_declutter_check_alerts_close_by_hand.sql", "admin_alert_manual_close"));
// The photo trigger as prod has it (newest definition, 20261014200728).
await db.exec(fnFrom("20261014200728_declutter_slice2_followups.sql", "declutter_photos_void_ai_check") + `
  CREATE TRIGGER trg_declutter_photos_void_ai_check AFTER INSERT OR DELETE ON public.declutter_item_photos
    FOR EACH ROW EXECUTE FUNCTION public.declutter_photos_void_ai_check();`);
if (SKIP) {
  // The columns alone, so the "before" run shows the old rules (not a missing column).
  await db.exec(`ALTER TABLE public.declutter_item_private ADD COLUMN ai_check_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN ai_check_last_try_at timestamptz;`);
} else {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  if (!SKIP_FOLLOWUP) for (let i = 0; i < 3; i++) await db.exec(FOLLOWUP);
}
if (SKIP_FOLLOWUP) console.log("FOLLOWUP skipped: S20-S29 show the sweep before 20261101042045 (expect FAILs there)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
async function call(uid, sql, args = []) {
  await as(uid);
  try {
    return { ok: (await db.query(sql, args)).rows };
  } catch (e) {
    return { err: e.message };
  }
}
/** A listing that went live `mins` minutes ago with no check recorded. */
async function liveUnchecked(n, seller, mins, extra = {}) {
  await db.query(`INSERT INTO public.declutter_items (id, seller_id, status, title, category, live_at, is_seed, admin_approved_at)
    VALUES ($1, $2, $3, $4, 'furniture', now() - make_interval(mins => $5), $6, $7)`,
    [I(n), seller, extra.status ?? "live", `Item ${n}`, mins, extra.seed ?? false, extra.approved ?? null]);
  await db.query(`INSERT INTO public.declutter_item_photos VALUES ($1, $2, 'p.jpg', 0)`, [P(n), I(n)]);
  await db.query(`INSERT INTO public.declutter_item_private (item_id, floor_price_cents, ai_checked_at, ai_flag_reason) VALUES ($1, 3000, $2, $3)`,
    [I(n), extra.checked ? new Date().toISOString() : null, extra.flag ?? null]);
}
const status = async (n) => (await one("SELECT status FROM public.declutter_items WHERE id = $1", [I(n)])).status;
const tries = async (n) => (await one("SELECT ai_check_attempts AS a FROM public.declutter_item_private WHERE item_id = $1", [I(n)])).a;
const claim = async () => {
  const r = await call(null, "SELECT * FROM public.declutter_check_sweep_claim(5)");
  return r.err ? { err: r.err } : { ids: r.ok.map((x) => x.sweep_item_id), rows: r.ok };
};
const hold = () => call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
const lastTryBack = (n) => db.query("UPDATE public.declutter_item_private SET ai_check_last_try_at = now() - interval '5 minutes' WHERE item_id = $1", [I(n)]);
async function verdict(n, seller, flag) {
  const it = await one("SELECT title, description, category FROM public.declutter_items WHERE id = $1", [I(n)]);
  const ids = (await db.query("SELECT id FROM public.declutter_item_photos WHERE item_id = $1", [I(n)])).rows.map((r) => r.id);
  return call(null, "SELECT public.declutter_record_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7) AS t",
    [I(n), seller, ids, it.title, it.description, it.category, flag]);
}
const TEST_SELLER = "00000000-0000-4000-8000-0000000000a3";
await db.query("INSERT INTO public.test_subjects VALUES ($1)", [TEST_SELLER]);

// ---- 1. Owner rule: a listing whose check never RAN is not held.
await liveUnchecked(1, SELLER, 20);
let r = await hold();
check("S1 an unchecked listing live 20 min with no failed try stays LIVE", (await status(1)) === "live", `${JSON.stringify(r)} ${await status(1)}`);

// ---- 2. The sweep's claim.
await liveUnchecked(2, SELLER, 2);                         // too new: the app's own check gets 5 minutes
await liveUnchecked(3, SELLER, 20, { seed: true });         // test data (is_seed)
await liveUnchecked(4, TEST_SELLER, 20);                    // a test account's
await liveUnchecked(5, SELLER, 20, { checked: true });      // already checked
await liveUnchecked(6, SELLER, 20, { approved: new Date().toISOString() }); // an admin approved it since it went live
await liveUnchecked(7, SELLER, 20, { status: "draft" });     // never posted
let c = await claim();
check("S2 the claim picks the live, unchecked listing past 5 minutes", c.ids?.length === 1 && c.ids[0] === I(1), JSON.stringify(c));
check("S3 ... and returns its seller from the row, try 1", c.rows?.[0]?.sweep_seller_id === SELLER && c.rows?.[0]?.sweep_attempt === 1, JSON.stringify(c.rows));
check("S4 ... never test data, a too-new, checked, admin-approved or draft listing", !!c.ids && [2, 3, 4, 5, 6, 7].every((n) => !c.ids.includes(I(n))), JSON.stringify(c.ids));
c = await claim();
check("S5 a listing just tried is not tried again for 5 minutes", c.ids?.length === 0, JSON.stringify(c));
for (const want of [2, 3]) {
  await lastTryBack(1);
  c = await claim();
  check(`S6 try ${want} counted before it runs`, c.rows?.[0]?.sweep_attempt === want && (await tries(1)) === want, JSON.stringify(c.rows));
  r = await hold();
  check(`  after ${want} tries the fail-safe ${want < 3 ? "still leaves it LIVE" : "holds it"}`, (await status(1)) === (want < 3 ? "live" : "pending_review"), await status(1));
}
await lastTryBack(1);
c = await claim();
check("S7 3 tries and the sweep stops", c.ids?.length === 0, JSON.stringify(c));
// Lead 10-31 (4): the third try's clean verdict lands just after the fail-safe held it: it goes back on sale.
r = await verdict(1, SELLER, null);
check("S19 a clean verdict landing on the held (pending_review) listing puts it back LIVE", !!r.ok && (await status(1)) === "live", `${JSON.stringify(r)} ${await status(1)}`);

// ---- 3. A clean check resets the count; an edit that clears the check gives 3 fresh tries.
await liveUnchecked(8, SELLER, 20);
await claim();
await lastTryBack(8);
await claim();
check("S8 two failed tries recorded", (await tries(8)) === 2, String(await tries(8)));
r = await verdict(8, SELLER, null);
check("S9 a clean check lands and the count resets", r.ok && (await tries(8)) === 0 && (await status(8)) === "live", `${JSON.stringify(r)} ${await tries(8)}`);
await db.query("UPDATE public.declutter_item_private SET ai_check_attempts = 2 WHERE item_id = $1", [I(8)]);
await db.query("UPDATE public.declutter_item_private SET ai_checked_at = NULL WHERE item_id = $1", [I(8)]);
check("S10 an edit that clears the check resets the count", (await tries(8)) === 0, String(await tries(8)));
c = await claim();
check("S10b ... and the app's own check gets 5 minutes before the sweep tries", !!c.ids && !c.ids.includes(I(8)), JSON.stringify(c));
await lastTryBack(8);
c = await claim();
check("  then the sweep tries it", !!c.ids && c.ids.includes(I(8)), JSON.stringify(c));

// ---- 3b. A try that says nothing about the listing (our fault, a stale verdict) is given back.
await liveUnchecked(11, SELLER, 20);
await claim();
check("S16 claimed: one try counted", (await tries(11)) === 1, String(await tries(11)));
r = await call(null, "SELECT public.declutter_check_sweep_give_back($1) AS n", [I(11)]);
check("S17 given back: no try counted", r.ok?.[0]?.n === 0 && (await tries(11)) === 0, JSON.stringify(r));
r = await call(null, "SELECT public.declutter_check_sweep_give_back($1) AS n", [I(11)]);
check("  never below 0", (await tries(11)) === 0, String(await tries(11)));
const gb = await one(`SELECT has_function_privilege('anon', 'public.declutter_check_sweep_give_back(uuid)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_check_sweep_give_back(uuid)', 'EXECUTE') AS u`).catch((e) => ({ err: e.message }));
check("S18 members cannot give tries back", gb?.a === false && gb?.u === false, JSON.stringify(gb));

// ---- 4. A flag still holds (unchanged).
await liveUnchecked(9, SELLER, 20, { checked: true, flag: "looks like a vape" });
await hold();
check("S11 a flagged listing back on sale is held", (await status(9)) === "pending_review", await status(9));

// ---- 5. Reserved before any check: the sale stands and no payout hold until 3 tries failed.
await liveUnchecked(10, SELLER, 20, { status: "reserved" });
await hold();
const ph0 = (await one("SELECT count(*)::int AS n FROM public.payout_holds WHERE helper_id = $1", [SELLER])).n;
check("S12 a reserved unchecked listing with no failed try holds no payout", ph0 === 0, String(ph0));
await db.query("UPDATE public.declutter_item_private SET ai_check_attempts = 3 WHERE item_id = $1", [I(10)]);
await hold();
const ph1 = (await one("SELECT count(*)::int AS n FROM public.payout_holds WHERE helper_id = $1", [SELLER])).n;
check("S13 ... after 3 failed tries the payout is held for an admin", ph1 === 1, String(ph1));

// ---- 6. Only the service role; scheduled once every 5 minutes.
const g = await one(`SELECT has_function_privilege('anon', 'public.declutter_check_sweep_claim(integer)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_check_sweep_claim(integer)', 'EXECUTE') AS u,
  has_function_privilege('service_role', 'public.declutter_check_sweep_claim(integer)', 'EXECUTE') AS s`).catch((e) => ({ err: e.message }));
check("S14 members cannot claim (anon, authenticated); the service role can", g?.a === false && g?.u === false && g?.s === true, JSON.stringify(g));
const job = (await db.query("SELECT schedule, command FROM cron.job WHERE jobname = 'declutter-check-sweep'")).rows;
check("S15 scheduled once, every 5 minutes, posting mode check_sweep with the service key", job.length === 1 && job[0].schedule === "1-59/5 * * * *"
  && job[0].command.includes('{"mode":"check_sweep"}') && job[0].command.includes("name = 'service_role_key'") && job[0].command.includes("/functions/v1/declutter-ai-draft"), JSON.stringify(job));

// ---- 7. B56-SWEEP-FOLLOWUPS (1): an edit to a listing that was NEVER checked gives it 3 fresh tries.
// The edit's own statement, verbatim from declutter_edit_listing (20261031083708) and declutter_update_draft.
const EDIT_CLEARS = "UPDATE public.declutter_item_private SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now() WHERE item_id = $1";
await liveUnchecked(20, SELLER, 30);
await db.query("UPDATE public.declutter_item_private SET ai_check_attempts = 3, ai_check_last_try_at = now() - interval '10 minutes' WHERE item_id = $1", [I(20)]);
await hold();
check("S20 3 failed tries on a never-checked listing: held", (await status(20)) === "pending_review", await status(20));
await db.query(EDIT_CLEARS, [I(20)]);
check("S21 the seller edits it (the check stays NULL -> NULL): the count resets to 0", (await tries(20)) === 0, String(await tries(20)));
c = await claim();
check("S22 ... the app's own check gets 5 minutes first", !!c.ids && !c.ids.includes(I(20)), JSON.stringify(c));
await lastTryBack(20);
c = await claim();
check("S23 ... then the sweep tries the edited listing again", !!c.ids && c.ids.includes(I(20)), JSON.stringify(c));
await liveUnchecked(21, SELLER, 30);
await db.query("UPDATE public.declutter_item_private SET ai_check_attempts = 2 WHERE item_id = $1", [I(21)]);
await db.query("INSERT INTO public.declutter_item_photos VALUES ($1, $2, 'p2.jpg', 1)", ["00000000-0000-4000-8000-000000000299", I(21)]);
check("S24 a photo added to a never-checked listing resets its count too", (await tries(21)) === 0, String(await tries(21)));
// The sweep's own writes never reset it (they never name ai_checked_at).
await lastTryBack(21);
await claim();
check("  the sweep's own try still counts", (await tries(21)) === 1, String(await tries(21)));

// ---- 8. B56-SWEEP-FOLLOWUPS (2): admins are told when a listing is on sale 45+ minutes with no check.
const alertsNow = async () => (await one("SELECT count(*)::int AS n FROM public.notifications WHERE type = 'admin_alert' AND title = 'Declutter photo checks are not running'")).n;
await db.query("DELETE FROM public.declutter_item_private");
await db.query("DELETE FROM public.declutter_items");
await liveUnchecked(30, SELLER, 50);                            // overdue
await liveUnchecked(31, SELLER, 50, { seed: true });            // test data
await liveUnchecked(32, TEST_SELLER, 50);                       // a test account's
await liveUnchecked(33, SELLER, 30);                            // only 30 minutes
await liveUnchecked(34, SELLER, 50, { checked: true });         // checked
await liveUnchecked(35, SELLER, 50, { approved: new Date().toISOString() }); // an admin approved it
await liveUnchecked(36, SELLER, 50, { status: "reserved" });    // reserved, no check: overdue too
// The listings were inserted with their check already NULL; on prod the clear happened when they went live. (With
// FOLLOWUP=skip the column does not exist; the run then shows S25-S29 red, which is the point.)
const clearedAgo = (mins, ids) => (SKIP_FOLLOWUP ? null : db.query(
  "UPDATE public.declutter_item_private SET ai_check_cleared_at = now() - make_interval(mins => $1) WHERE item_id = ANY ($2::uuid[])", [mins, ids]));
await clearedAgo(50, [I(30), I(31), I(32), I(34), I(35), I(36)]);
await clearedAgo(30, [I(33)]);
r = await call(null, "SELECT public.declutter_alert_overdue_checks() AS n");
const note = (await db.query("SELECT user_id, message, link FROM public.notifications WHERE type = 'admin_alert' AND title = 'Declutter photo checks are not running'")).rows;
check("S25 one alert to the admin naming the 2 overdue listings (never test data, too-new, checked or approved ones)",
  r.ok?.[0]?.n === 2 && note.length === 1 && note[0].user_id === ADMIN && note[0].message.startsWith("2 listings have been on sale 45+ minutes")
  && note[0].message.includes('"Item 30"') && note[0].message.includes('"Item 36"') && !/Item 3[1-5]/.test(note[0].message), `${JSON.stringify(r)} ${JSON.stringify(note)}`);
r = await call(null, "SELECT public.declutter_alert_overdue_checks() AS n");
check("S26 each listing is alerted once", r.ok?.[0]?.n === 0 && (await alertsNow()) === 1, `${JSON.stringify(r)} ${await alertsNow()}`);
// An edit clears its check again: alerted again only after another 45 minutes with no check. (The first alert is
// moved 55 minutes back, so the clock moved back below still falls after it, as it would in real time.)
if (!SKIP_FOLLOWUP) await db.query("UPDATE public.declutter_item_private SET ai_check_overdue_alerted_at = now() - interval '55 minutes' WHERE item_id = $1", [I(30)]);
await db.query(EDIT_CLEARS, [I(30)]);
r = await call(null, "SELECT public.declutter_alert_overdue_checks() AS n");
const quiet = r.ok?.[0]?.n === 0;
await clearedAgo(50, [I(30)]);
r = await call(null, "SELECT public.declutter_alert_overdue_checks() AS n");
check("S28 an edit re-arms it: no alert right after, one once it is 45 minutes unchecked again", quiet && r.ok?.[0]?.n === 1 && (await alertsNow()) === 2,
  `${quiet} ${JSON.stringify(r)} ${await alertsNow()}`);
const mc = await one(`SELECT public.admin_alert_manual_close('Declutter photo checks are not running') AS n,
  public.admin_alert_manual_close('A sold Declutter listing was never checked') AS s,
  public.admin_alert_manual_close('A sold Declutter listing failed its check') AS f,
  public.admin_alert_manual_close('Cancellation fee transfer failed') AS c`).catch((e) => ({ err: e.message }));
check("S29 the alert closes by hand, and its siblings still do", mc?.n === true && mc?.s === true && mc?.f === true && mc?.c === true, JSON.stringify(mc));
const ga = await one(`SELECT has_function_privilege('anon', 'public.declutter_alert_overdue_checks()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_alert_overdue_checks()', 'EXECUTE') AS u`).catch((e) => ({ err: e.message }));
const jo = (await db.query("SELECT schedule, command FROM cron.job WHERE jobname = 'declutter-check-overdue'")).rows;
check("S27 members cannot run it; scheduled once every 15 minutes straight from SQL", ga?.a === false && ga?.u === false && jo.length === 1
  && jo[0].schedule === "7-59/15 * * * *" && jo[0].command.includes("public.declutter_alert_overdue_checks()"), `${JSON.stringify(ga)} ${JSON.stringify(jo)}`);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
