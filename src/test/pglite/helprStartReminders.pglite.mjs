#!/usr/bin/env node
/**
 * PGlite proof for 20261030035326_helpr_start_reminders.sql (Q2483, owner
 * 2026-10-29: three more start reminders for hired Helprs, each ON by default
 * and switchable in Job reminders).
 *
 * Builds the state the migration lands on (Q2482's 20261030031059 on top of the
 * live fan_out_push_on_notification and claim_payout_setup_reminders, and the
 * live sms_kind_for from 20261023181442), applies the new migration 3x
 * (replay-safe), then drives sweep_helpr_start_reminders(p_now) across every
 * edge 1 ms before / at / 1 ms after:
 *   - "Your job starts in 2 hours" at start - 2h, with the address and the
 *     job-card link (Directions), never early, not 105+ minutes late;
 *   - "You have a job today" at 8 AM Central on the job day, only for a 10 AM
 *     or later start; on the DST day (2026-11-01, CST) and the day before (CDT);
 *   - "Time to head out" at start - 30 min while On my way is not tapped;
 *     carried by Starting soon (nothing extra) while that switch is on;
 *   - once only; never for a cancelled job or a Helpr no longer on it; crew
 *     members each get theirs; a switched-off reminder is not written;
 *   - each pushes on its own switch (category off), texts as starting_soon /
 *     job_update; registry and access.
 *
 *   node src/test/pglite/helprStartReminders.pglite.mjs                      # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/helprStartReminders.pglite.mjs   # RED: before the fix
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
    location text, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz);
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
await db.exec(readFileSync(`${MIG}20261030031059_job_reminder_choices.sql`, "utf8"));
if (MODE) {
  // Only the switches, so the cases below can run against the old behaviour.
  await db.exec(`ALTER TABLE public.notification_preferences ADD COLUMN remind_two_hours boolean NOT NULL DEFAULT true,
    ADD COLUMN remind_morning_of boolean NOT NULL DEFAULT true, ADD COLUMN remind_head_out boolean NOT NULL DEFAULT true;`);
} else {
  const NEW = readFileSync(`${MIG}20261030035326_helpr_start_reminders.sql`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const fmt = (x) => JSON.stringify(x);
const H = (n) => u(100 + n); // Helprs
const P = u(99); // the poster
// Helpr preferences: H1 defaults, H2 Starting soon off, H3 Job updates category off,
// H7 2-hour reminder off, H8 head-out off and Starting soon off.
await db.exec(`INSERT INTO public.notification_preferences (user_id) VALUES ('${H(1)}');
  INSERT INTO public.notification_preferences (user_id, remind_starting_soon) VALUES ('${H(2)}', false), ('${H(4)}', false);
  INSERT INTO public.notification_preferences (user_id, job_updates) VALUES ('${H(3)}', false);
  INSERT INTO public.notification_preferences (user_id, remind_two_hours) VALUES ('${H(7)}', false);
  INSERT INTO public.notification_preferences (user_id, remind_head_out, remind_starting_soon) VALUES ('${H(8)}', false, false);`);

/** A solo job. Times are America/Chicago wall clock. */
const job = async (n, helper, date, time, extra = {}) => {
  const status = extra.status ?? "accepted";
  await db.exec(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, location, helper_on_the_way_at)
    VALUES ('${u(n)}', 'Job ${n}', '${P}', ${helper ? `'${helper}'` : "NULL"}, '${status}', '${date}', '${time}',
            ${extra.location === null ? "NULL" : `'${extra.location ?? "12 Oak St, Lafayette"}'`}, ${extra.onTheWay ? "now()" : "NULL"})`);
};
const sweep = (at) => tryq(`SELECT public.sweep_helpr_start_reminders('${at}'::timestamptz) AS n`);
const rows = async (n, title, user) =>
  (await tryq(`SELECT user_id::text AS u, message, link, job_id::text AS j FROM public.notifications
                WHERE job_id = '${u(n)}' AND title = '${title.replace(/'/g, "''")}'${user ? ` AND user_id = '${user}'` : ""}`)).rows;
const TWO = "Your job starts in 2 hours";
const DAY = "You have a job today";
const OUT = "Time to head out";

// ---- 1. Two hours before. Job 1 starts 2026-11-03 14:00 CST = 20:00Z, so the edge is 18:00Z.
await job(1, H(1), "2026-11-03", "14:00");
let s = await sweep("2026-11-03T17:59:59.999Z");
check("2h: 1 ms before the edge, nothing", !s.error && (await rows(1, TWO)).length === 0, s.error ?? "");
s = await sweep("2026-11-03T18:00:00.000Z");
let r = await rows(1, TWO, H(1));
check("2h: at the edge, the Helpr gets it once", !s.error && r.length === 1, s.error ?? fmt(r));
check("2h: names the time and the address", r[0]?.message === '"Job 1" starts at 2:00 PM at 12 Oak St, Lafayette. Tap for directions.', fmt(r[0]));
check("2h: opens the job card (Directions)", r[0]?.link === `/jobs?job=${u(1)}` && r[0]?.j === u(1), fmt(r[0]));
await sweep("2026-11-03T18:00:00.001Z");
await sweep("2026-11-03T18:10:00.000Z");
check("2h: 1 ms after and later runs, still once", (await rows(1, TWO)).length === 1, fmt(await rows(1, TWO)));
check("2h: the poster gets none", (await rows(1, TWO, P)).length === 0);
await job(2, H(1), "2026-11-03", "14:00");
await sweep("2026-11-03T18:00:00.001Z");
check("2h: first seen 1 ms after the edge, sent", (await rows(2, TWO)).length === 1);
await job(3, H(1), "2026-11-03", "14:00", { location: null });
await sweep("2026-11-03T18:14:59.999Z");
check("2h: no address, still sent without one", (await rows(3, TWO))[0]?.message === '"Job 3" starts at 2:00 PM. Tap for directions.', fmt(await rows(3, TWO)));
await job(4, H(1), "2026-11-03", "14:00");
await sweep("2026-11-03T18:15:00.000Z");
check("2h: 105 minutes before is too late for 'in 2 hours', not sent", (await rows(4, TWO)).length === 0);

// ---- 2. 8 AM Central on the job day. 2026-11-03 is CST: 8 AM = 14:00Z.
await job(10, H(1), "2026-11-03", "10:00");
await job(11, H(1), "2026-11-03", "09:59");
await job(12, H(1), "2026-11-04", "15:00");
await sweep("2026-11-03T13:59:59.999Z");
check("8am: 1 ms before 8 AM, nothing", (await rows(10, DAY)).length === 0);
await sweep("2026-11-03T14:00:00.000Z");
r = await rows(10, DAY, H(1));
check("8am: at 8 AM, a 10 AM job gets it", r.length === 1 && r[0].message === 'You have a job today at 10:00 AM: "Job 10".', fmt(r));
check("8am: a 9:59 AM job never does", (await rows(11, DAY)).length === 0);
check("8am: tomorrow's job does not, today", (await rows(12, DAY)).length === 0);
await sweep("2026-11-03T14:00:00.001Z");
await sweep("2026-11-03T14:30:00.000Z");
check("8am: 1 ms after and later runs, still once", (await rows(10, DAY)).length === 1);
await job(13, H(1), "2026-11-03", "16:00");
await sweep("2026-11-03T15:00:00.000Z");
check("8am: 9 AM is past the window, a job first seen then is not told", (await rows(13, DAY)).length === 0);
// DST: 2026-11-01 falls back at 2 AM, so its 8 AM is CST (14:00Z); 2026-10-31 is CDT (13:00Z).
await job(14, H(1), "2026-11-01", "11:00");
await job(15, H(1), "2026-10-31", "11:00");
await sweep("2026-10-31T12:59:59.999Z");
check("8am DST eve (CDT): 1 ms before 13:00Z, nothing", (await rows(15, DAY)).length === 0);
await sweep("2026-10-31T13:00:00.000Z");
check("8am DST eve (CDT): at 13:00Z = 8 AM CDT, sent", (await rows(15, DAY)).length === 1);
await sweep("2026-11-01T13:00:00.000Z");
check("8am DST day (CST): 13:00Z is 7 AM, not sent", (await rows(14, DAY)).length === 0);
await sweep("2026-11-01T13:59:59.999Z");
check("8am DST day (CST): 1 ms before 14:00Z, not sent", (await rows(14, DAY)).length === 0);
await sweep("2026-11-01T14:00:00.000Z");
await sweep("2026-11-01T14:00:00.001Z");
check("8am DST day (CST): at 14:00Z = 8 AM CST, sent once", (await rows(14, DAY)).length === 1);

// ---- 3. Head out, 30 minutes before. Jobs start 2026-11-05 14:00 CST = 20:00Z, edge 19:30Z.
await job(20, H(2), "2026-11-05", "14:00"); // Starting soon off: gets "Time to head out"
await job(21, H(1), "2026-11-05", "14:00"); // defaults: Starting soon carries it
await job(22, H(2), "2026-11-05", "14:00", { onTheWay: true });
await sweep("2026-11-05T19:29:59.999Z");
check("head out: 1 ms before, nothing", (await rows(20, OUT)).length === 0);
await sweep("2026-11-05T19:30:00.000Z");
r = await rows(20, OUT, H(2));
check("head out: at the edge, Starting soon off, sent", r.length === 1 && r[0].message === '"Job 20" starts in about 30 minutes. Head out now and tap On my way.', fmt(r));
check("head out: Starting soon on, merged into it (no second reminder)", (await rows(21, OUT)).length === 0);
const m = await tryq(`SELECT merged FROM public.helpr_start_reminder_sends WHERE job_id = '${u(21)}' AND kind = 'head_out'`);
check("head out: the merge is recorded once", m.rows.length === 1 && m.rows[0].merged === true, m.error ?? fmt(m.rows));
check("head out: tapped On my way, not sent", (await rows(22, OUT)).length === 0);
await sweep("2026-11-05T19:30:00.001Z");
await sweep("2026-11-05T19:45:00.000Z");
check("head out: 1 ms after and later runs, still once", (await rows(20, OUT)).length === 1);
await job(23, H(2), "2026-11-05", "14:00");
await sweep("2026-11-05T20:00:00.000Z");
check("head out: at the start time, too late, not sent", (await rows(23, OUT)).length === 0);
await job(24, H(2), "2026-11-05", "14:00");
await db.exec(`UPDATE public.jobs SET helper_arrived_at = now() WHERE id = '${u(24)}'`);
await sweep("2026-11-05T19:40:00.000Z");
check("head out: already arrived, not sent", (await rows(24, OUT)).length === 0);

// ---- 4. Never for a cancelled job or a Helpr no longer on it.
await job(30, H(1), "2026-11-06", "14:00", { status: "cancelled" });
await job(31, H(2), "2026-11-06", "14:00");
await sweep("2026-11-06T18:00:00.000Z");
check("cancelled: no 2-hour reminder", (await rows(30, TWO)).length === 0);
check("reassign: first Helpr gets the 2-hour one", (await rows(31, TWO, H(2))).length === 1);
await db.exec(`UPDATE public.jobs SET helper_id = '${H(4)}' WHERE id = '${u(31)}'`);
await sweep("2026-11-06T19:30:00.000Z");
check("reassign: the removed Helpr gets no head-out", (await rows(31, OUT, H(2))).length === 0);
check("reassign: the new Helpr gets theirs", (await rows(31, OUT, H(4))).length === 1);
await job(32, H(1), "2026-11-06", "14:00");
await db.exec(`UPDATE public.jobs SET status = 'cancelled' WHERE id = '${u(32)}'`);
await sweep("2026-11-06T19:30:00.001Z");
check("cancelled after hire: no head-out either", (await tryq(`SELECT 1 FROM public.helpr_start_reminder_sends WHERE job_id = '${u(32)}'`)).rows.length === 0);

// ---- 5. Crew: every current member, once each.
await db.exec(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, is_group_job, date_needed, start_time, location)
  VALUES ('${u(40)}', 'Job 40', '${P}', NULL, 'open', true, '2026-11-07', '14:00', '9 Elm St');
  INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${u(40)}', '${H(5)}'), ('${u(40)}', '${H(6)}');`);
await sweep("2026-11-07T18:00:00.000Z");
await sweep("2026-11-07T18:05:00.000Z");
r = await rows(40, TWO);
check("crew: each member gets the 2-hour one once", r.length === 2 && new Set(r.map((x) => x.u)).size === 2, fmt(r));
await db.exec(`DELETE FROM public.group_job_helpers WHERE job_id = '${u(40)}' AND helper_id = '${H(6)}'`);
// (the push fan-out already made H5's preferences row with the defaults)
await db.exec(`UPDATE public.notification_preferences SET remind_starting_soon = false WHERE user_id = '${H(5)}'`);
await sweep("2026-11-07T19:30:00.000Z");
check("crew: a member who left gets no head-out", (await rows(40, OUT, H(6))).length === 0);
check("crew: a current member does", (await rows(40, OUT, H(5))).length === 1);

// ---- 6. Switches and channels.
await job(50, H(7), "2026-11-08", "14:00");
await job(51, H(8), "2026-11-08", "14:00");
await job(52, H(3), "2026-11-08", "14:00");
await db.exec("DELETE FROM public.pushes");
await sweep("2026-11-08T18:00:00.000Z");
check("2-hour switch off: not written", (await rows(50, TWO)).length === 0);
await sweep("2026-11-08T19:30:00.000Z");
check("head-out switch off (Starting soon off too): not written", (await rows(51, OUT)).length === 0);
check("Job updates category off: the 2-hour reminder still arrives", (await rows(52, TWO, H(3))).length === 1);
const pu = await tryq(`SELECT count(*)::int AS n FROM public.pushes WHERE user_id = '${H(3)}' AND title = '${TWO}'`);
check("Job updates category off: and still pushes (its own switch decides)", pu.rows[0]?.n === 1, pu.error ?? fmt(pu.rows));
const sk = await tryq(`SELECT public.sms_kind_for('job_update', '${TWO}', '${u(1)}') AS a, public.sms_kind_for('job_update', '${OUT}', '${u(1)}') AS b,
  public.sms_kind_for('job_update', '${DAY}', '${u(1)}') AS c, public.sms_kind_for('job_update', 'Starting soon', NULL) AS d,
  public.sms_kind_for('job_match', 'x', '${u(1)}') AS e`);
const k = sk.rows[0] ?? {};
check("text: 2-hour and head-out are as urgent as Starting soon", k.a === "starting_soon" && k.b === "starting_soon", fmt(k));
check("text: 8 AM is an ordinary job text; Starting soon and job matches unchanged", k.c === "job_update" && k.d === "starting_soon" && k.e === null, fmt(k));
const dfx = await tryq(`SELECT count(*)::int AS n FROM public.cron_defects`);
check("no sweep logged a defect", dfx.rows[0]?.n === 0, fmt(dfx.rows));

// ---- 7. Registry and access.
r = (await tryq(`SELECT kind, always_on, pref_column FROM public.job_reminder_types WHERE kind IN ('two_hours','morning_of','head_out') ORDER BY sort_order`)).rows;
check("registry: the three are switchable, each on its own column", fmt(r) === fmt([
  { kind: "morning_of", always_on: false, pref_column: "remind_morning_of" },
  { kind: "two_hours", always_on: false, pref_column: "remind_two_hours" },
  { kind: "head_out", always_on: false, pref_column: "remind_head_out" },
]), fmt(r));
r = (await tryq(`SELECT count(*)::int AS n FROM public.job_reminder_types t WHERE t.pref_column IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                   AND c.table_name = 'notification_preferences' AND c.column_name = t.pref_column)`)).rows;
check("every switchable reminder names a real preferences column", r[0]?.n === 0, fmt(r));
const dflt = await tryq(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'notification_preferences'
  AND column_name IN ('remind_two_hours','remind_morning_of','remind_head_out') AND column_default = 'true' AND is_nullable = 'NO'`);
check("the three switches are NOT NULL DEFAULT true (ON for everyone)", dflt.rows[0]?.n === 3, fmt(dflt.rows));
for (const role of ["anon", "authenticated"]) {
  const x = await asRole(role, `SELECT public.sweep_helpr_start_reminders(NULL)`);
  check(`${role} cannot run the sweep`, !!x.error, x.error ?? "allowed");
  const y = await asRole(role, `SELECT count(*) FROM public.helpr_start_reminder_sends`);
  check(`${role} cannot read the sends log`, !!y.error, y.error ?? "allowed");
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
