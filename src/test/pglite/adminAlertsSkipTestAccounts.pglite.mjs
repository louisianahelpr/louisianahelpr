#!/usr/bin/env node
/**
 * PGlite proof for 20261030143141_admin_alerts_skip_test_accounts (owner 2026-10-30:
 * "test stuff must NEVER show in admin or on the owner's notifications").
 *
 *   node src/test/pglite/adminAlertsSkipTestAccounts.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminAlertsSkipTestAccounts.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod chain, each body read from the migration whose md5
 * equals prod's prosrc (2026-10-30):
 *   notifications BEFORE INSERT -> notifications_seed_boundary
 *     -> notification_crosses_seed_boundary   (20260923121354, md5 8e776832...)
 *   notify_admins_new_member                   (20261027154114, md5 ee09a4f0...)
 *   declutter_refund_request_to_admin          (20261029225634, md5 2f21a4d4...)
 *   declutter_notify / declutter_notify_strict (prod bodies)
 *   is_test_member, is_fixture_email, notification_job_id_from_link (prod bodies)
 * Stubs: declutter_notice_type / declutter_price_words / declutter_notice_names_item
 * return their input (they shape the copy, not who receives it); log_cron_defect
 * is a no-op; auth.uid() reads request.jwt.claim.sub as PostgREST sets it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261030143141_admin_alerts_skip_test_accounts.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

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
const SEED_ADMIN = U(2); // the owner's test admin (is_seed + test_accounts)
const REAL = U(3);
const REAL2 = U(4);
const THROWAWAY = U(5); // mailinator sign-up nobody marked is_seed
const SEEDED = U(6); // is_seed
const RESERVED = U(7); // @example.com, not marked
const JOB_BY_THROWAWAY = "33333333-0000-0000-0000-000000000001";
const JOB_REAL = "33333333-0000-0000-0000-000000000002";

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

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, location text, is_seed boolean DEFAULT false);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz DEFAULT now(), note text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text,
  message text, type text, link text, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text,
  channel text, status text, subject text, job_id uuid, error_message text);
CREATE TABLE public.new_member_admin_notices (user_id uuid PRIMARY KEY, via text);
CREATE TABLE public.pre_verification_wipes (user_id uuid, error text, wiped_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY, order_id uuid, reason text, note text,
  photo_paths text[], status text DEFAULT 'open', problem_id uuid);
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reporter_id uuid,
  reporter_side text, reason text, note text, photo_paths text[], status text DEFAULT 'open');

CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text) RETURNS text LANGUAGE sql AS $$ SELECT p_type $$;
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
CREATE FUNCTION public.declutter_notice_names_item(p_user uuid, p_other uuid, p_link text, p_message text) RETURNS text LANGUAGE sql AS $$ SELECT p_message $$;

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
  // The live chain, verbatim from the migrations that equal prod.
  await db.exec(stmt("20260923121354_seed_subject_never_notifies_real.sql", "notification_crosses_seed_boundary"));
  await db.exec(stmt("20260923121354_seed_subject_never_notifies_real.sql", "notifications_seed_boundary"));
  await db.exec(`CREATE TRIGGER trg_notifications_seed_boundary BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notifications_seed_boundary();`);
  await db.exec(stmt("20261027154114_admin_new_member_notice_skips_every_test_account.sql", "notify_admins_new_member"));
  await db.exec(stmt("20261029225634_declutter_problem_both_sides_and_photos.sql", "declutter_refund_request_to_admin"));

  await db.exec(`
INSERT INTO auth.users VALUES
  ('${ADMIN}', 'owner@realmail.com', now()), ('${SEED_ADMIN}', 'owner.test@mailinator.com', now()),
  ('${REAL}', 'neighbor@realmail.com', now()), ('${REAL2}', 'other@realmail.com', now()),
  ('${THROWAWAY}', 'eone.audit@mailinator.com', now()), ('${SEEDED}', 'seed@realmail.com', now()),
  ('${RESERVED}', 'probe@example.com', now());
INSERT INTO public.profiles (user_id, full_name, location, is_seed) VALUES
  ('${ADMIN}', 'Owner', 'Lafayette', false), ('${SEED_ADMIN}', 'Owner Test', 'Lafayette', true),
  ('${REAL}', 'Neighbor', 'Baton Rouge', false), ('${REAL2}', 'Other', 'Monroe', false),
  ('${THROWAWAY}', 'Eone Audit', 'Lafayette', false), ('${SEEDED}', 'Seed Person', 'Lafayette', true),
  ('${RESERVED}', 'Probe', 'Lafayette', false);
INSERT INTO public.test_accounts (user_id) VALUES ('${SEED_ADMIN}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${SEED_ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('${JOB_BY_THROWAWAY}', '${THROWAWAY}', NULL, false), ('${JOB_REAL}', '${REAL}', NULL, false);
INSERT INTO public.declutter_orders VALUES
  ('44444444-0000-0000-0000-000000000001', '${THROWAWAY}', '${REAL}'),
  ('44444444-0000-0000-0000-000000000002', '${REAL}', '${REAL2}');
INSERT INTO public.declutter_refund_requests (id, order_id, reason, note) VALUES
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'damaged', 'broken'),
  ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', 'damaged', 'broken');
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
const asMember = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    await db.exec(sql);
  } finally {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};

// 1. "New member joined": an unmarked mailinator throwaway is never announced.
const nmThrow = (await db.query(`SELECT public.notify_admins_new_member('${THROWAWAY}') AS r`)).rows[0].r;
check("new member: a mailinator sign-up nobody marked is_seed is not announced", nmThrow === "seed", `returned ${nmThrow}`);
check("new member: ... and no admin got 'New member joined' for it",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE link LIKE '%${THROWAWAY}'`)) === 0);
const nmRes = (await db.query(`SELECT public.notify_admins_new_member('${RESERVED}') AS r`)).rows[0].r;
check("new member: an @example.com sign-up is not announced", nmRes === "seed", `returned ${nmRes}`);
const nmReal = (await db.query(`SELECT public.notify_admins_new_member('${REAL}') AS r`)).rows[0].r;
check("new member: a real sign-up IS announced (control)", nmReal === "sent" && (await count(
  `SELECT count(*) AS n FROM public.notifications WHERE user_id = '${ADMIN}' AND link LIKE '%${REAL}'`)) === 1, `returned ${nmReal}`);

// 2. The gate itself, for a 'New member joined' an older build might still insert.
await db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES ('${ADMIN}', 'Old build notice', 'x', 'admin_alert', '/admin?view=people&user=${THROWAWAY}')`);
check("gate: an admin row naming an unmarked throwaway (user=) is dropped", (await adminRows("Old build notice")) === 0);
const logged = await count(`SELECT count(*) AS n FROM public.notification_logs WHERE subject = 'Old build notice' AND status = 'suppressed_seed'`);
check("gate: ... and the drop is logged suppressed_seed", logged === 1, `${logged} log rows`);

// 3. Declutter problem reported by a test member (the alert links to bare '/admin').
await asMember(THROWAWAY, `SELECT public.declutter_notify('${ADMIN}', 'warning', 'Declutter problem reported', 'm', '/admin')`);
check("gate: a Declutter problem a test member reported never reaches the admin", (await adminRows("Declutter problem reported")) === 0);
await asMember(REAL, `SELECT public.declutter_notify('${ADMIN}', 'warning', 'Problem by a real member', 'm', '/admin')`);
check("gate: a problem a real member reported DOES reach the admin (control)", (await adminRows("Problem by a real member")) === 1);
await asMember(THROWAWAY, `SELECT public.declutter_notify('${REAL2}', 'warning', 'Member-facing from a test caller', 'm', '/declutter?view=selling')`);
check("gate: the auth.uid() rule is admin-only (a member-facing notice still lands)",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${REAL2}' AND title = 'Member-facing from a test caller'`)) === 1);

// 4. Declutter refund to decide (can run with no signed-in member).
await db.exec(`SELECT public.declutter_refund_request_to_admin('55555555-0000-0000-0000-000000000001', 'no agreement')`);
check("refund: a test buyer's refund request never reaches the admin", (await adminRows("Declutter refund to decide")) === 0);
await db.exec(`SELECT public.declutter_refund_request_to_admin('55555555-0000-0000-0000-000000000002', 'no agreement')`);
check("refund: two real members' request DOES reach the admin (control)", (await adminRows("Declutter refund to decide")) === 1);
check("refund: the request still moves to_admin either way",
  (await count(`SELECT count(*) AS n FROM public.declutter_refund_requests WHERE status = 'to_admin'`)) === 2);

// 5. Admin row about a job an unmarked test account posted.
await db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES ('${ADMIN}', 'Job stalled', 'x', 'admin_alert', '/admin?view=stalled&job=${JOB_BY_THROWAWAY}'),
         ('${ADMIN}', 'Real job stalled', 'x', 'admin_alert', '/admin?view=stalled&job=${JOB_REAL}')`);
check("gate: an admin alert about a throwaway's job is dropped", (await adminRows("Job stalled")) === 0);
check("gate: an admin alert about a real job lands (control)", (await adminRows("Real job stalled")) === 1);

// 6. Member-facing, actor in the link: an unmarked throwaway never notifies a real member.
await db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES ('${REAL}', 'From a throwaway', 'x', 'message', '/messages?userId=${THROWAWAY}'),
         ('${REAL}', 'From a real member', 'x', 'message', '/messages?userId=${REAL2}')`);
check("gate: a throwaway actor never notifies a real member",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${REAL}' AND title = 'From a throwaway'`)) === 0);
check("gate: a real actor still notifies (control)",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${REAL}' AND title = 'From a real member'`)) === 1);

// 7. A seed recipient (the owner's test admin) still gets test traffic: seed-to-seed is allowed.
await db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES ('${SEED_ADMIN}', 'Seed to seed', 'x', 'admin_alert', '/admin?view=people&user=${SEEDED}')`);
check("gate: seed-to-seed still allowed (the test admin sees test alerts)",
  (await count(`SELECT count(*) AS n FROM public.notifications WHERE user_id = '${SEED_ADMIN}' AND title = 'Seed to seed'`)) === 1);

// 8. Grants: the new helper is service_role only.
if (MODE !== "skip") {
  const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'is_test_subject'`)).rows[0]?.a ?? "";
  check("grants: is_test_subject is not executable by PUBLIC, anon or authenticated",
    acl.includes("service_role=X") && !/(^|[{,])=X/.test(acl) && !acl.includes("anon=") && !acl.includes("authenticated="), acl);
} else {
  check("grants: is_test_subject exists", false, "not created in the live state");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
