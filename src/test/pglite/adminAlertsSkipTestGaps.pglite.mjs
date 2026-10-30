#!/usr/bin/env node
/**
 * PGlite proof for 20261030150104_admin_alerts_skip_test_gaps (owner 2026-10-30:
 * "test stuff must NEVER show in admin or on the owner's notifications"): the five
 * admin notifiers 20261030143141's gate cannot see through, plus the Slack page
 * for a dispute.
 *
 *   node src/test/pglite/adminAlertsSkipTestGaps.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminAlertsSkipTestGaps.pglite.mjs   # RED: before this migration
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the prod chain plus the queued 20261030143141 (this branch stacks on
 * it; it adds is_test_subject and widens the notification gate). Each function
 * under test is read verbatim from the migration whose md5 equals prod's prosrc
 * (2026-10-30):
 *   facilitated_la_sales_cents, facilitator_threshold_check, shop_refund_sweep
 *                                   (20261019071055; md5 cc7e84db, 9839773d, e9032b8b)
 *   enforce_retained_payment_ban    (20261006014801; md5 5f3c20ac)
 *   sweep_open_ban_settlement_reviews (20261006030849; md5 f0a7fa1f)
 *   open_dispute_as                 (20261005064816; md5 2134e232)
 *   notify_ops_dispute_filed        (20260924130917; md5 d7c3ed28)
 *   notification gate + trigger     (20260923121354, then 20261030143141)
 * Stubs (they decide money or copy, not who is told): shop_lock_open_charged_order
 * reads the row, shop_write_refund writes a refunds row, shop_give_strike,
 * retain_ban_for_user, log_cron_defect are no-ops, ban_fingerprint is md5,
 * check_dispute_velocity is true, get_supabase_url/get_service_role_key are NULL
 * (so a real dispute's Slack post stops at "vault secrets missing").
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261030150104_admin_alerts_skip_test_gaps.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before this migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** The newest `CREATE OR REPLACE FUNCTION public.<fn>(` statement in a migration, verbatim. */
function stmt(file, fn) {
  const s = mig(file);
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "g");
  let m;
  let last = null;
  while ((m = re.exec(s))) last = m.index;
  if (last === null) throw new Error(`${fn} not in ${file}`);
  const as = /\bAS\s+(\$[A-Za-z_]*\$)/g;
  as.lastIndex = last;
  const a = as.exec(s);
  const end = s.indexOf(a[1], a.index + a[0].length) + a[1].length;
  return s.slice(last, s.indexOf(";", end) + 1);
}

const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1);
const REAL = U(3);
const REAL2 = U(4);
const THROWAWAY = U(5); // mailinator sign-up nobody marked is_seed
const RESERVED = U(7); // @example.com, not marked
const J = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `44444444-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

async function build() {
  const db = new PGlite();
  await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, location text, email text,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz DEFAULT now(), note text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, status text,
  payment_status text, is_group_job boolean DEFAULT false, is_seed boolean DEFAULT false,
  dispute_evidence_urls text[], disputed_by uuid, disputed_at timestamptz, dispute_status text,
  dispute_reason text, dispute_helper_response text, dispute_resolved_at timestamptz);
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, opener_id uuid, reason text,
  evidence_urls text[], status text DEFAULT 'open', execution_status text, helper_response text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid,
  flag_type text, details text, resolved boolean DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text,
  message text, type text, link text, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text,
  channel text, status text, subject text, job_id uuid, error_message text);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text,
  tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
-- 20261030143141 also restates these two; their tables only need to exist.
CREATE TABLE public.new_member_admin_notices (user_id uuid PRIMARY KEY, via text);
CREATE TABLE public.pre_verification_wipes (user_id uuid, error text, wiped_at timestamptz);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY, order_id uuid, reason text, note text,
  photo_paths text[], status text DEFAULT 'open', problem_id uuid);
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reporter_id uuid,
  reporter_side text, reason text, note text, photo_paths text[], status text DEFAULT 'open');

CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, items_cents integer,
  status text, handed_over_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, items_cents integer, status text,
  captured_at timestamptz, handover_mode text, ready_date date, close_reason text, closed_at timestamptz,
  handed_over_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_photo_path text, problem_at timestamptz);
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reason text,
  refund_cents integer, card_fee_cents integer);
CREATE TABLE public.facilitator_threshold_alerts (year integer PRIMARY KEY, threshold_cents bigint,
  total_cents_at_alert bigint, ops_alert_sent_at timestamptz);

CREATE TABLE public.payment_fingerprints (user_id uuid, fingerprint_kind text, fingerprint_sha256 text,
  last_seen_at timestamptz DEFAULT now(), UNIQUE (user_id, fingerprint_kind, fingerprint_sha256));
CREATE TABLE public.retained_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_sha256 text,
  card_sha256 text[] DEFAULT '{}', bank_sha256 text[] DEFAULT '{}', ban_status text, reason text,
  expires_at timestamptz, retained_at timestamptz DEFAULT now(), reapplied_at timestamptz);
CREATE TABLE public.ban_evasion_matches (user_id uuid, matched_on text, match_sha256 text, retained_ban_id uuid,
  original_ban_status text, original_reason text, original_recorded_at timestamptz, original_expires_at timestamptz,
  auto_banned boolean, cleared_at timestamptz, UNIQUE (user_id, matched_on, retained_ban_id));
CREATE TABLE public.user_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, ban_type text, reason text,
  banned_by uuid, expires_at timestamptz, is_active boolean);
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, matched_on text,
  original_ban_status text, original_expires_at timestamptz, review_state text DEFAULT 'open',
  created_at timestamptz DEFAULT now(), alerted_at timestamptz);
CREATE UNIQUE INDEX ban_settlement_queue_open ON public.ban_settlement_queue (user_id) WHERE review_state = 'open';
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text, held_by uuid, held_at timestamptz);

CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text) RETURNS text LANGUAGE sql AS $$ SELECT p_type $$;
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
CREATE FUNCTION public.declutter_notice_names_item(p_user uuid, p_other uuid, p_link text, p_message text) RETURNS text LANGUAGE sql AS $$ SELECT p_message $$;
CREATE FUNCTION public.shop_lock_open_charged_order(p_id uuid, p_x boolean) RETURNS public.shop_orders LANGUAGE sql AS $$
  SELECT * FROM public.shop_orders WHERE id = p_id $$;
CREATE FUNCTION public.shop_write_refund(p_order uuid, p_reason text, p_x uuid) RETURNS public.shop_refunds LANGUAGE sql AS $$
  INSERT INTO public.shop_refunds (order_id, reason, refund_cents, card_fee_cents) VALUES (p_order, p_reason, 2500, 103) RETURNING * $$;
CREATE FUNCTION public.shop_give_strike(p_user uuid, p_kind text, p_reason text, p_ref uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.ban_fingerprint(p_kind text, p_fp text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5(p_kind || p_fp) $$;
CREATE FUNCTION public.retain_ban_for_user(p_user uuid, p_why text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.check_dispute_velocity(p_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.dispute_evidence_url_ok(p_url text, p_user uuid, p_job uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;

CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
           lower(btrim(p_email)) LIKE '%@mailinator.com'
        OR lower(btrim(p_email)) LIKE '%@helpr.test'
        OR lower(btrim(p_email)) LIKE 'eli.test.%',
         false)
$$;
CREATE FUNCTION public.is_test_member(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.is_seed IS TRUE)
    OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
  );
$$;
CREATE FUNCTION public.notification_job_id_from_link(p_link text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(COALESCE(
             (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
             (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
             (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
             (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]), '')::uuid
$$;
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, p_link), p_title,
          public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, p_link, p_message)), p_link);
END $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM public.declutter_notify_strict(p_user, p_type, p_title, p_message, p_link, p_other);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_notify: %', SQLERRM;
  END;
END $$;
`);
  // The prod chain, verbatim from the migrations that equal prod.
  await db.exec(stmt("20260923121354_seed_subject_never_notifies_real.sql", "notification_crosses_seed_boundary"));
  await db.exec(stmt("20260923121354_seed_subject_never_notifies_real.sql", "notifications_seed_boundary"));
  await db.exec(`CREATE TRIGGER trg_notifications_seed_boundary BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notifications_seed_boundary();`);
  await db.exec(stmt("20261019071055_shops_refunds_cancels_strikes.sql", "facilitated_la_sales_cents"));
  await db.exec(stmt("20261019071055_shops_refunds_cancels_strikes.sql", "facilitator_threshold_check"));
  await db.exec(stmt("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_sweep"));
  await db.exec(stmt("20261006014801_ban_evasion_card_bank_and_name.sql", "enforce_retained_payment_ban"));
  await db.exec(stmt("20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql", "sweep_open_ban_settlement_reviews"));
  await db.exec(stmt("20261005064816_dispute_refile_keeps_helpr_answer.sql", "open_dispute_as"));
  await db.exec(stmt("20260924130917_lock_seed_read_in_dispute_alert.sql", "notify_ops_dispute_filed"));
  // The queued base this branch stacks on (is_test_subject + the wider gate).
  await db.exec(mig("20261030143141_admin_alerts_skip_test_accounts.sql"));

  await db.exec(`
INSERT INTO auth.users VALUES
  ('${ADMIN}', 'owner@realmail.com', now()), ('${REAL}', 'neighbor@realmail.com', now()),
  ('${REAL2}', 'other@realmail.com', now()), ('${THROWAWAY}', 'eone.audit@mailinator.com', now()),
  ('${RESERVED}', 'probe@example.com', now());
INSERT INTO public.profiles (user_id, full_name, email) VALUES
  ('${ADMIN}', 'Owner', 'owner@realmail.com'), ('${REAL}', 'Neighbor', 'neighbor@realmail.com'),
  ('${REAL2}', 'Other', 'other@realmail.com'), ('${THROWAWAY}', 'Eone Audit', 'eone.audit@mailinator.com'),
  ('${RESERVED}', 'Probe', 'probe@example.com');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
  return db;
}

const db = await build();
if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  console.log("applied the new migration 3x");
}

const count = async (sql) => Number((await db.query(sql)).rows[0].n);
const adminRows = (title) =>
  count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND title = '${title}'`);

// 1. Louisiana sales total (facilitator_threshold_check): test accounts' sales never count.
await db.exec(`
INSERT INTO public.declutter_orders (id, buyer_id, seller_id, items_cents, status, handed_over_at) VALUES
  ('${O(1)}', '${REAL}', '${REAL2}', 7000000, 'handed_over', now()),
  ('${O(2)}', '${THROWAWAY}', '${REAL2}', 1500000, 'handed_over', now());
INSERT INTO public.shop_orders (id, buyer_id, seller_id, items_cents, status, handed_over_at) VALUES
  ('${O(3)}', '${REAL}', '${RESERVED}', 900000, 'handed_over', now());
`);
const total = Number((await db.query(`SELECT public.facilitated_la_sales_cents(
  extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer) AS n`)).rows[0].n);
check("sales total: a mailinator buyer's and an @example.com seller's sales are left out", total === 7000000, `total ${total}`);
await db.exec(`SELECT public.facilitator_threshold_check()`);
check("sales tax alert: test accounts' sales do not push it over the line (no admin alert)",
  (await adminRows("Louisiana sales tax registration coming")) === 0);
await db.exec(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, items_cents, status, handed_over_at)
  VALUES ('${O(4)}', '${REAL2}', '${REAL}', 1200000, 'handed_over', now())`);
await db.exec(`SELECT public.facilitator_threshold_check()`);
check("sales tax alert: real sales over the line DO alert the admin (control)",
  (await adminRows("Louisiana sales tax registration coming")) === 1);

// 2. Shops order refunded by the clock (cron, bare '/admin' link).
await db.exec(`
INSERT INTO public.shop_orders (id, buyer_id, seller_id, items_cents, status, captured_at, handover_mode, ready_date, is_seed) VALUES
  ('${O(5)}', '${THROWAWAY}', '${REAL}', 2500, 'accepted', now(), 'porch', current_date - 6, false),
  ('${O(6)}', '${REAL}', '${REAL2}', 2500, 'accepted', now(), 'porch', current_date - 6, true),
  ('${O(7)}', '${REAL2}', '${REAL}', 2500, 'accepted', now(), 'porch', current_date - 6, false);
`);
const swept = (await db.query(`SELECT public.shop_refund_sweep() AS r`)).rows[0].r;
check("shop sweep: all three late orders are still refunded", swept.no_ready_photo_refunded === 3, JSON.stringify(swept));
check("shop sweep: only the real order (not the test buyer's, not the seed order) alerts the admin",
  (await adminRows("Shops order refunded by the clock")) === 1,
  `${await adminRows("Shops order refunded by the clock")} admin rows`);

// 3. Ban settlement review opened (service role, '/admin?view=fraud' with no subject).
await db.exec(`
INSERT INTO public.retained_bans (email_sha256, card_sha256, ban_status, reason) VALUES
  ('other', ARRAY[md5('card' || 'fp_test')], 'banned', 'old'),
  ('other2', ARRAY[md5('card' || 'fp_real')], 'banned', 'old');
`);
const rTest = (await db.query(`SELECT public.enforce_retained_payment_ban('${THROWAWAY}', 'card', 'fp_test') AS r`)).rows[0].r;
check("ban match: a test account is still banned on the match", rTest.banned === true, JSON.stringify(rTest));
check("ban match: ... but no admin hears of it",
  (await adminRows("Ban settlement review: an account was banned automatically")) === 0);
check("ban match: ... and its error_logs row is seed-tagged (digest, never a page)",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ban-settlement-review-opened'
    AND context->>'user_id' = '${THROWAWAY}' AND tags->>'seed' = 'true'`)) === 1);
await db.exec(`SELECT public.enforce_retained_payment_ban('${REAL}', 'card', 'fp_real')`);
check("ban match: a real account's match DOES alert the admin (control)",
  (await adminRows("Ban settlement review: an account was banned automatically")) === 1);
check("ban match: ... and its error_logs row is NOT seed-tagged (it pages)",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ban-settlement-review-opened'
    AND context->>'user_id' = '${REAL}' AND coalesce(tags->>'seed', 'false') = 'false'`)) === 1);

// 4. Ban review still waiting (hourly cron).
await db.exec(`UPDATE public.ban_settlement_queue SET created_at = now() - interval '30 hours'`);
const watch = (await db.query(`SELECT public.sweep_open_ban_settlement_reviews() AS r`)).rows[0].r;
check("ban watch: both stale reviews are handled", watch.paged === 2, JSON.stringify(watch));
check("ban watch: only the real account's review reaches the admin's bell",
  (await adminRows("Ban settlement review still waiting")) === 1);
check("ban watch: the test account's page is seed-tagged; the real one's is not",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ban-settlement-review-open'
    AND context->>'user_id' = '${THROWAWAY}' AND tags->>'seed' = 'true'`)) === 1
  && (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ban-settlement-review-open'
    AND context->>'user_id' = '${REAL}' AND coalesce(tags->>'seed', 'false') = 'false'`)) === 1);

// 5. Job disputed (service role; the admin row carries the job, but a crew
//    member who opens it is neither the poster nor the Helpr).
await db.exec(`
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, is_group_job) VALUES
  ('${J(1)}', '${REAL}', NULL, 'Crew move', 'in_progress', 'paid', true),
  ('${J(2)}', '${REAL}', '${REAL2}', 'Real job', 'in_progress', 'paid', false),
  ('${J(3)}', '${THROWAWAY}', '${REAL2}', 'Throwaway job', 'in_progress', 'paid', false);
INSERT INTO public.group_job_helpers VALUES ('${J(1)}', '${THROWAWAY}');
`);
const why = "The work was never finished at all.";
await db.exec(`SELECT public.open_dispute_as('${J(1)}', '${THROWAWAY}', '${why}', NULL)`);
check("dispute: a test crew member's dispute never reaches the admin",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND job_id = '${J(1)}'`)) === 0);
check("dispute: ... and its Slack page goes to the digest (seed-tagged ops-alert-seed row)",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ops-alert-seed'
    AND context->'fields'->>'Job ID' = '${J(1)}'`)) === 1);
await db.exec(`SELECT public.open_dispute_as('${J(3)}', '${REAL2}', '${why}', NULL)`);
check("dispute: a real Helpr's dispute on a throwaway's job never reaches the admin",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND job_id = '${J(3)}'`)) === 0);
check("dispute: ... and its Slack page goes to the digest too",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ops-alert-seed'
    AND context->'fields'->>'Job ID' = '${J(3)}'`)) === 1);
await db.exec(`SELECT public.open_dispute_as('${J(2)}', '${REAL}', '${why}', NULL)`);
check("dispute: a real dispute DOES reach the admin (control)",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND job_id = '${J(2)}'
    AND title = 'Job disputed'`)) === 1);
check("dispute: ... and is not sent to the digest (it pages)",
  (await count(`SELECT count(*) AS n FROM public.error_logs WHERE tags->>'source' = 'ops-alert-seed'
    AND context->'fields'->>'Job ID' = '${J(2)}'`)) === 0);
check("dispute: all three disputes were filed",
  (await count(`SELECT count(*) AS n FROM public.disputes`)) === 3);

// 6. Grants: every restated function stays service_role only.
const acls = (await db.query(`SELECT proname, proacl::text AS a FROM pg_proc WHERE proname IN
  ('facilitated_la_sales_cents','shop_refund_sweep','enforce_retained_payment_ban',
   'sweep_open_ban_settlement_reviews','open_dispute_as','notify_ops_dispute_filed')`)).rows;
const badAcl = acls.filter((r) => !(r.a ?? "").includes("service_role=X") || /(^|[{,])=X/.test(r.a ?? "")
  || (r.a ?? "").includes("anon=") || (r.a ?? "").includes("authenticated="));
check("grants: each restated function is executable by service_role only", MODE === "skip" ? false : badAcl.length === 0 && acls.length === 6,
  MODE === "skip" ? "grants come from this migration" : JSON.stringify(badAcl));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
