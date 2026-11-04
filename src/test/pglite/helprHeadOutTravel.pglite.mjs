#!/usr/bin/env node
/**
 * PGlite proof for 20261104114456_helpr_head_out_travel_time.sql (Q2485: "Time to head out" at start minus the
 * Helpr's drive time; 30 minutes before with no estimate, the owner's Q2483 rule). Builds on Q2483's
 * 20261030035326 (applied verbatim), applies the new migration 3x, then drives sweep_helpr_start_reminders(p_now)
 * 1 ms before / at each edge:
 *   - a 50-minute estimate heads out at start - 50 min, says "about 50 minutes", and is NOT merged into Starting soon
 *     (sent 30-35 minutes before: a different moment), even with Starting soon on;
 *   - a 20-minute or a 10-minute estimate heads out at start - 20 / - 10 min, on its own even with Starting soon on
 *     (a later moment than Starting soon's; never trim a Helpr reminder); a 32-minute one, inside Starting soon's own
 *     30-35 window, is carried by it when that switch is on;
 *   - no estimate, or one over 120 minutes (a stale far-away position): 30 minutes, exactly as before;
 *   - an estimate under 5 minutes heads out 5 minutes before (the sweep runs every 5);
 *   - helpr_travel_pairs names who to measure (hired, 35 min - 3 h out, both points, not left, not sent, not measured
 *     in the last hour), and nobody while Apple is paused after an outage (declutter_route_health); service_role only.
 *
 *   node src/test/pglite/helprHeadOutTravel.pglite.mjs                      # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/helprHeadOutTravel.pglite.mjs   # RED: the Q2483 sweep (always 30 minutes)
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before the fix (expect FAILs)`);

/** The newest CREATE FUNCTION public.<name> statement in one migration (any dollar tag). */
function cut(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};
const tryq = async (q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};
const asRole = async (role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await tryq(q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE SCHEMA net;
  CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(90, 120) n;
  CREATE TABLE public.pushes (user_id uuid, title text);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql
    AS $$ INSERT INTO public.pushes VALUES ((body->>'user_id')::uuid, body->>'title') RETURNING 1::bigint $$;
  CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'https://x.supabase.co' $$;
  CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'k' $$;
  CREATE TABLE public.cron_defects (fn text, key text, err text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_key text, p_err text, p_ctx jsonb) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects VALUES (p_fn, p_key, p_err) $$;
  CREATE TABLE public.notification_preferences (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY,
    push_enabled boolean DEFAULT true, job_updates boolean DEFAULT true, system_alerts boolean DEFAULT true,
    financial_alerts boolean DEFAULT true, payments boolean DEFAULT true, work_status boolean DEFAULT true);
  CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
  INSERT INTO public.notification_type_pref_map VALUES ('job_update','job_updates',''),('job_updates','job_updates',''),
    ('warning','system_alerts',''),('financial_alerts','financial_alerts',''),('payment','payments','');
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL,
    title text, message text, link text, job_id uuid, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text NOT NULL,
    payment_status text, accepted_at timestamptz, is_group_job boolean DEFAULT false, date_needed date, start_time time,
    location text, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
    helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, parent_job_id uuid);
  CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
    helper_id uuid, joined_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean, is_seed boolean);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.payout_setup_reminders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL,
    reminder_key text NOT NULL, reminder_stage text NOT NULL, job_id uuid, claimed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (helper_id, reminder_key));
  CREATE FUNCTION public.feature_enabled_for_user(text, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
// The state this migration lands on.
await db.exec(cut("20260903012715_notification_preferences_always_exist.sql", "fan_out_push_on_notification"));
await db.exec(`CREATE TRIGGER notifications_fan_out_to_push AFTER INSERT ON public.notifications
               FOR EACH ROW EXECUTE FUNCTION public.fan_out_push_on_notification();`);
await db.exec(cut("20261027154326_payout_hired_reminder_only_for_fresh_hires.sql", "claim_payout_setup_reminders"));
await db.exec(cut("20261023181442_sms_no_nearby_job_texts.sql", "sms_kind_for"));
await db.exec(cut("20261008203441_arrival_gps_or_poster_and_step_order.sql", "job_posted_by_seed"));
await db.exec(readFileSync(`${MIG}20261030031059_job_reminder_choices.sql`, "utf8"));
// The state this migration lands on: Q2483's start reminders.
await db.exec(readFileSync(`${MIG}20261030035326_helpr_start_reminders.sql`, "utf8"));
// Q1930's shared Apple pause (20261104113516, the branch this one stacks on): its table as created there.
await db.exec(`CREATE TABLE IF NOT EXISTS public.declutter_route_health (id boolean PRIMARY KEY DEFAULT true CHECK (id),
  miss_until timestamptz, misses integer NOT NULL DEFAULT 0, last_miss_at timestamptz);`);
await db.exec(`ALTER TABLE public.jobs ADD COLUMN latitude numeric, ADD COLUMN longitude numeric;
  ALTER TABLE public.profiles ADD COLUMN latitude numeric, ADD COLUMN longitude numeric;`);
const NEW_FILE = "20261104114456_helpr_head_out_travel_time.sql";
if (MODE) {
  // Only the new table, so the cases below run against the old sweep (expect FAILs).
  await db.exec(`CREATE TABLE public.helpr_travel_estimates (job_id uuid, user_id uuid, minutes int, measured_at timestamptz DEFAULT now(),
    PRIMARY KEY (job_id, user_id))`);
} else {
  const NEW = readFileSync(process.env.MIGRATION_PATH ?? `${MIG}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("the migration applies 3x (replay-safe)", true);
}

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const fmt = (x) => JSON.stringify(x);
const H = (n) => u(100 + n); // Helprs
const P = u(99); // the poster
// H1 defaults (Starting soon on), H2 Starting soon off.
await db.exec(`INSERT INTO public.notification_preferences (user_id) VALUES ('${H(1)}');
  INSERT INTO public.notification_preferences (user_id, remind_starting_soon) VALUES ('${H(2)}', false);`);
/** A solo job on 2026-11-05 at 14:00 CST (= 20:00Z), hired and day-of confirmed, with an optional estimate. */
const job = async (n, helper, minutes, extra = {}) => {
  await db.exec(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, location, helper_on_the_way_at,
      helper_confirmed_at, helper_dayof_confirmed_at, latitude, longitude)
    VALUES ('${u(n)}', 'Job ${n}', '${P}', '${helper}', 'accepted', '${extra.date ?? "2026-11-05"}', '14:00', '12 Oak St',
            ${extra.onTheWay ? "now()" : "NULL"}, now(), now(), ${extra.noPoint ? "NULL" : "30.45"}, ${extra.noPoint ? "NULL" : "-91.18"})`);
  if (minutes !== null) await db.exec(`INSERT INTO public.helpr_travel_estimates (job_id, user_id, minutes) VALUES ('${u(n)}', '${helper}', ${minutes})`);
};
const sweep = (at) => tryq(`SELECT public.sweep_helpr_start_reminders('${at}'::timestamptz) AS n`);
const OUT = "Time to head out";
const sent = async (n) => (await tryq(`SELECT message FROM public.notifications WHERE job_id = '${u(n)}' AND title = '${OUT}'`)).rows;
const merged = async (n) => (await tryq(`SELECT merged FROM public.helpr_start_reminder_sends WHERE job_id = '${u(n)}' AND kind = 'head_out'`)).rows;

await job(1, H(2), 50); // Starting soon off, 50-minute drive
await job(2, H(1), 50); // Starting soon on, 50-minute drive: a different moment from Starting soon
await job(3, H(2), 20); // Starting soon off, 20-minute drive
await job(4, H(1), 20); // Starting soon on, 20-minute drive: a later moment than Starting soon, so its own
await job(8, H(1), 10); // Starting soon on, 10-minute drive: its own, at start - 10
await job(9, H(1), 32); // Starting soon on, 32-minute drive: inside Starting soon's 30-35 window, carried by it
await job(5, H(2), null); // no estimate
await job(6, H(2), 300); // a stale far-away position
await job(7, H(2), 2); // a very short drive
let s = await sweep("2026-11-05T19:09:59.999Z");
check("50-minute drive: 1 ms before start - 50 min, nothing", !s.error && (await sent(1)).length === 0, s.error ?? fmt(await sent(1)));
await sweep("2026-11-05T19:10:00.000Z");
check("50-minute drive: at start - 50 min, sent, saying about 50 minutes", fmt(await sent(1)) === fmt([{ message: '"Job 10" starts in about 50 minutes. Head out now and tap On my way.'.replace("Job 10", "Job 1") }]), fmt(await sent(1)));
check("50-minute drive, Starting soon on: still sent on its own (not the same moment as Starting soon)", (await sent(2)).length === 1 && (await merged(2))[0]?.merged === false, fmt([await sent(2), await merged(2)]));
check("no estimate: nothing yet at start - 50 min", (await sent(5)).length === 0);
check("a 300-minute 'drive' (stale position): ignored, nothing at start - 50 min", (await sent(6)).length === 0);
await sweep("2026-11-05T19:29:59.999Z");
check("no estimate: 1 ms before start - 30 min, nothing", (await sent(5)).length === 0);
await sweep("2026-11-05T19:30:00.000Z");
check("no estimate: at start - 30 min, the 30-minute rule, as before", fmt(await sent(5)) === fmt([{ message: '"Job 5" starts in about 30 minutes. Head out now and tap On my way.' }]), fmt(await sent(5)));
check("stale position: the 30-minute rule", (await sent(6)).length === 1 && (await sent(6))[0].message.includes("about 30 minutes"), fmt(await sent(6)));
check("20-minute drive: nothing at start - 30 min", (await sent(3)).length === 0);
await sweep("2026-11-05T19:39:59.999Z");
check("20-minute drive: 1 ms before start - 20 min, nothing", (await sent(3)).length === 0);
await sweep("2026-11-05T19:40:00.000Z");
check("20-minute drive: at start - 20 min, sent, saying about 20 minutes", (await sent(3))[0]?.message === '"Job 3" starts in about 20 minutes. Head out now and tap On my way.', fmt(await sent(3)));
check("20-minute drive, Starting soon on: still sent on its own (later than Starting soon; never trimmed)", (await sent(4)).length === 1 && (await merged(4))[0]?.merged === false, fmt([await sent(4), await merged(4)]));
check("32-minute drive, Starting soon on: carried by Starting soon (same 30-35 window; merged, nothing extra)", (await sent(9)).length === 0 && (await merged(9))[0]?.merged === true, fmt([await sent(9), await merged(9)]));
check("10-minute drive: nothing at start - 20 min", (await sent(8)).length === 0 && (await merged(8)).length === 0, fmt([await sent(8), await merged(8)]));
await sweep("2026-11-05T19:49:59.999Z");
check("10-minute drive: 1 ms before start - 10 min, nothing", (await sent(8)).length === 0);
await sweep("2026-11-05T19:50:00.000Z");
check("10-minute drive, Starting soon on: at start - 10 min, sent on its own, saying about 10 minutes",
  (await sent(8))[0]?.message === '"Job 8" starts in about 10 minutes. Head out now and tap On my way.' && (await merged(8))[0]?.merged === false,
  fmt([await sent(8), await merged(8)]));
await sweep("2026-11-05T19:54:59.999Z");
check("2-minute drive: not before start - 5 min", (await sent(7)).length === 0);
await sweep("2026-11-05T19:55:00.000Z");
check("2-minute drive: at start - 5 min (the sweep's cadence)", (await sent(7))[0]?.message?.includes("about 5 minutes") === true, fmt(await sent(7)));
await sweep("2026-11-05T19:59:00.000Z");
check("each is still sent once", [1, 2, 3, 5, 6, 7].every(async () => true) && (await sent(1)).length === 1 && (await sent(3)).length === 1);

// ---- Who the cron measures (helpr_travel_pairs). Jobs on 2026-11-06 14:00 CST = 20:00Z.
await db.exec(`INSERT INTO public.profiles (user_id, latitude, longitude) VALUES ('${H(3)}', 30.22, -92.02), ('${H(4)}', 30.22, -92.02), ('${H(5)}', NULL, NULL)`);
await job(30, H(3), null, { date: "2026-11-06" }); // measured
await job(31, H(4), null, { date: "2026-11-06", onTheWay: true }); // already left
await job(32, H(5), null, { date: "2026-11-06" }); // no saved position
await job(33, H(3), null, { date: "2026-11-06", noPoint: true }); // the job has no point
await job(34, H(4), 40, { date: "2026-11-06" }); // measured just now
await db.exec(`UPDATE public.helpr_travel_estimates SET measured_at = '2026-11-06T16:30:00Z' WHERE job_id = '${u(34)}'`);
const pairs = async (at) => {
  const q = await tryq(`SELECT job_id::text AS j, from_lat::text AS fl, to_lat::text AS tl FROM public.helpr_travel_pairs('${at}'::timestamptz) ORDER BY 1`);
  return q.error ? q.error : q.rows;
};
check("pairs: 3 h 1 min before, nobody yet", fmt(await pairs("2026-11-06T16:59:00.000Z")) === "[]", fmt(await pairs("2026-11-06T16:59:00.000Z")));
let pr = await pairs("2026-11-06T17:00:00.000Z");
check("pairs: 3 h before, the hired Helpr with both points (saved position -> the job)", fmt(pr) === fmt([{ j: u(30), fl: "30.22", tl: "30.45" }]), fmt(pr));
check("pairs: 34 minutes before, nobody (too late to matter)", fmt(await pairs("2026-11-06T19:26:00.000Z")) === "[]", fmt(await pairs("2026-11-06T19:26:00.000Z")));
await db.exec(`UPDATE public.helpr_travel_estimates SET measured_at = '2026-11-06T17:30:00Z' WHERE job_id = '${u(34)}'`);
check("pairs: an estimate from the last hour is not re-measured", !fmt(await pairs("2026-11-06T18:00:00.000Z")).includes(u(34)));
check("pairs: an older one is", fmt(await pairs("2026-11-06T18:31:00.000Z")).includes(u(34)));
await db.exec(`UPDATE public.profiles SET latitude = 95 WHERE user_id = '${H(4)}'`);
check("pairs: a saved position out of range is never a pair (it would read as an Apple outage)", !fmt(await pairs("2026-11-06T18:31:00.000Z")).includes(u(34)), fmt(await pairs("2026-11-06T18:31:00.000Z")));
await db.exec(`UPDATE public.profiles SET latitude = 30.22 WHERE user_id = '${H(4)}'`);
await db.exec(`INSERT INTO public.declutter_route_health (id, miss_until) VALUES (true, '2026-11-06T18:40:00Z')`);
check("pairs: nobody while Apple is paused after an outage", fmt(await pairs("2026-11-06T18:39:59.999Z")) === "[]", fmt(await pairs("2026-11-06T18:39:59.999Z")));
check("pairs: measured again once the pause ends", fmt(await pairs("2026-11-06T18:40:00.000Z")).includes(u(30)), fmt(await pairs("2026-11-06T18:40:00.000Z")));
const acl = (await tryq(`SELECT has_function_privilege('authenticated', 'public.helpr_travel_pairs(timestamptz)', 'EXECUTE') a,
  has_function_privilege('anon', 'public.helpr_travel_pairs(timestamptz)', 'EXECUTE') b,
  has_function_privilege('service_role', 'public.helpr_travel_pairs(timestamptz)', 'EXECUTE') s,
  has_table_privilege('authenticated', 'public.helpr_travel_estimates', 'SELECT') t`)).rows[0] ?? {};
check("members and anon neither run the pairs read nor read the estimates; service_role runs it", acl.a === false && acl.b === false && acl.s === true && acl.t === false, fmt(acl));

console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL ${passes} PASS`);
process.exit(failures ? 1 : 0);
