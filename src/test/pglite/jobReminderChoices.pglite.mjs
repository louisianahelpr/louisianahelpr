#!/usr/bin/env node
/**
 * PGlite proof for 20261030031059_job_reminder_choices.sql (owner 2026-10-29:
 * job reminders are always on or switchable, ON by default, in one Settings
 * section; the always-on ones still push with their category off).
 *
 * Builds the live state (fan_out_push_on_notification from 20260903012715,
 * claim_payout_setup_reminders from 20261027154326), then applies the new
 * migration 3x (replay-safe), and checks:
 *   - category off: every always-on reminder still pushes; an ordinary
 *     notification of that category still does not;
 *   - a switchable reminder turned off is not written at all (no row, no push);
 *     turned on (the default, or no preferences row) it is written and pushed;
 *   - payout 'money' and the follow-ups share a title: money stays always on,
 *     follow-ups follow their switch, in the notice gate and in the claim;
 *   - push_enabled (all push off) is still honoured;
 *   - every switchable registry row names a real preferences column;
 *   - anon/authenticated cannot call the helpers; authenticated can read the registry.
 *
 *   node src/test/pglite/jobReminderChoices.pglite.mjs                      # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/jobReminderChoices.pglite.mjs   # RED: live state
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

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
  CREATE TABLE public.notification_preferences (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY,
    push_enabled boolean DEFAULT true, job_updates boolean DEFAULT true, system_alerts boolean DEFAULT true,
    financial_alerts boolean DEFAULT true, payments boolean DEFAULT true, work_status boolean DEFAULT true);
  CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
  INSERT INTO public.notification_type_pref_map VALUES ('job_update','job_updates',''),('job_updates','job_updates',''),
    ('warning','system_alerts',''),('financial_alerts','financial_alerts',''),('payment','payments','');
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL,
    title text, message text, link text, job_id uuid, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
  -- claim_payout_setup_reminders' tables (as payoutHiredReminderFreshHires.pglite.mjs).
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, helper_id uuid, status text NOT NULL,
    payment_status text, accepted_at timestamptz);
  CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
    helper_id uuid NOT NULL, joined_at timestamptz);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean, is_seed boolean);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.payout_setup_reminders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL,
    reminder_key text NOT NULL, reminder_stage text NOT NULL, job_id uuid, claimed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (helper_id, reminder_key));
  CREATE FUNCTION public.feature_enabled_for_user(text, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
// The live state.
await db.exec(cut("20260903012715_notification_preferences_always_exist.sql", "fan_out_push_on_notification"));
await db.exec(`CREATE TRIGGER notifications_fan_out_to_push AFTER INSERT ON public.notifications
               FOR EACH ROW EXECUTE FUNCTION public.fan_out_push_on_notification();`);
await db.exec(cut("20261027154326_payout_hired_reminder_only_for_fresh_hires.sql", "claim_payout_setup_reminders"));
if (MODE) {
  // Only the switches, so the cases below can run against the live behaviour.
  await db.exec(`ALTER TABLE public.notification_preferences ADD COLUMN remind_starting_soon boolean NOT NULL DEFAULT true,
    ADD COLUMN remind_finish_job boolean NOT NULL DEFAULT true, ADD COLUMN remind_payout_followups boolean NOT NULL DEFAULT true;`);
} else {
  const NEW = readFileSync(`${MIG}20261030031059_job_reminder_choices.sql`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const H1 = u(1); // categories off
const H2 = u(2); // switchable reminders off
const H3 = u(3); // defaults
const H4 = u(4); // no preferences row
const H5 = u(5); // all push off
await db.exec(`INSERT INTO public.notification_preferences (user_id, job_updates, system_alerts, financial_alerts) VALUES ('${H1}', false, false, false);
               INSERT INTO public.notification_preferences (user_id, remind_starting_soon, remind_finish_job, remind_payout_followups) VALUES ('${H2}', false, false, false);
               INSERT INTO public.notification_preferences (user_id) VALUES ('${H3}');
               INSERT INTO public.notification_preferences (user_id, push_enabled) VALUES ('${H5}', false);`);

const MONEY = `Your pay from "Hang shelves" is held until your payout account is ready. Finish your payout setup (Stripe ID check and bank, a few minutes) so it can reach you.`;
const FOLLOW = "You have a job on Helpr. Finish your payout setup (Stripe ID check and bank, a few minutes) so your pay can reach you.";
const esc = (s) => s.replace(/'/g, "''");
/** Insert one notification; answer whether its row landed and whether it pushed. */
const send = async (uid, type, title, message = "m") => {
  await db.exec("DELETE FROM public.pushes");
  const r = await tryq(`INSERT INTO public.notifications (user_id, type, title, message) VALUES ('${uid}', '${type}', '${esc(title)}', '${esc(message)}') RETURNING id`);
  const p = await tryq(`SELECT count(*)::int AS n FROM public.pushes WHERE user_id = '${uid}'`);
  return { row: r.rows.length === 1, push: (p.rows[0]?.n ?? 0) > 0, error: r.error };
};
const fmt = (x) => JSON.stringify(x);

// 1. Category off: the always-on reminders still push.
const ALWAYS = [
  ["job_update", "Still on for tomorrow?"],
  ["job_update", "Confirm you'll be there"],
  ["warning", "Job reposted", "You didn't confirm \"X\" 2 hours before it started, so it was reposted to other Helprs. Don't go."],
  ["warning", "Job cancelled", "Sam cancelled \"X\". Don't go."],
  ["job_updates", "We've asked support to step in"],
  ["financial_alerts", "You're hired. Set up payouts to get paid."],
  ["financial_alerts", "Finish payout setup to get paid", MONEY],
];
for (const [type, title, msg] of ALWAYS) {
  const r = await send(H1, type, title, msg);
  check(`category off: always-on "${title}" is written and still pushes`, r.row && r.push, fmt(r));
}
let r = await send(H1, "job_update", "Your job was edited");
check("category off: an ordinary job update is written but does not push", r.row && !r.push, fmt(r));

// 2. A switchable reminder turned off is not written at all; on, it is.
for (const [type, title, msg] of [["job_update", "Starting soon"], ["job_updates", "Did you finish this job?"], ["financial_alerts", "Finish payout setup to get paid", FOLLOW]]) {
  r = await send(H2, type, title, msg);
  check(`switched off: "${title}${msg ? " (follow-up)" : ""}" is not written and does not push`, !r.row && !r.push && !r.error, fmt(r));
  r = await send(H3, type, title, msg);
  check(`default on: "${title}${msg ? " (follow-up)" : ""}" is written and pushes`, r.row && r.push, fmt(r));
}
r = await send(H2, "financial_alerts", "Finish payout setup to get paid", MONEY);
check("payout follow-ups off: the money reminder (same title) is still written and pushed", r.row && r.push, fmt(r));
r = await send(H4, "job_update", "Starting soon");
check("no preferences row: a switchable reminder is on", r.row && r.push, fmt(r));
r = await send(H1, "job_update", "Starting soon");
check("a switchable reminder follows its own switch, not the category (Job updates off, Starting soon on)", r.row && r.push, fmt(r));

// 3. All push off is still all push off.
r = await send(H5, "job_update", "Still on for tomorrow?");
check("push_enabled off: an always-on reminder is written but not pushed", r.row && !r.push, fmt(r));

// 4. Payout claim: follow-ups skipped when off, money unchanged.
await db.exec(`
  INSERT INTO public.profiles VALUES ('${H2}', NULL, NULL, false), ('${H3}', NULL, NULL, false);
  INSERT INTO public.jobs VALUES ('${u(201)}', 'Hang shelves', '${H2}', 'accepted', 'escrow', now() - interval '30 hours'),
                                 ('${u(203)}', 'Mow lawn', '${H3}', 'accepted', 'escrow', now() - interval '30 hours');
  INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, reminder_stage, job_id, claimed_at) VALUES
    ('${H2}', 'hired:${u(201)}', 'hired', '${u(201)}', now() - interval '30 hours'),
    ('${H3}', 'hired:${u(203)}', 'hired', '${u(203)}', now() - interval '30 hours');`);
let c = await tryq(`SELECT helper_id::text AS h, stage FROM public.claim_payout_setup_reminders(100) ORDER BY 1`);
const byH = Object.fromEntries(c.rows.map((x) => [x.h, x.stage]));
check("payout claim: follow-ups off, no day1 is claimed", !c.error && byH[H2] === undefined, c.error ?? fmt(c.rows));
check("payout claim: default on, day1 is claimed", byH[H3] === "day1", fmt(c.rows));
await db.exec(`INSERT INTO public.jobs VALUES ('${u(202)}', 'Paint fence', '${H2}', 'completed', 'payout_pending', now() - interval '40 hours')`);
c = await tryq(`SELECT helper_id::text AS h, stage FROM public.claim_payout_setup_reminders(100) WHERE helper_id = '${H2}'`);
check("payout claim: follow-ups off, the money reminder is still claimed", c.rows.length === 1 && c.rows[0].stage === "money", c.error ?? fmt(c.rows));

// 5. Registry shape and access.
r = await tryq(`SELECT count(*)::int AS n FROM public.job_reminder_types t WHERE t.pref_column IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                                  AND c.table_name = 'notification_preferences' AND c.column_name = t.pref_column)`);
check("every switchable reminder names a real preferences column", !r.error && r.rows[0]?.n === 0, r.error ?? fmt(r.rows));
r = await tryq(`SELECT count(*)::int AS a, count(*) FILTER (WHERE always_on)::int AS b FROM public.job_reminder_types`);
check("registry: 10 reminders, 7 always on", r.rows[0]?.a === 10 && r.rows[0]?.b === 7, r.error ?? fmt(r.rows));
for (const role of ["anon", "authenticated"]) {
  const k = await asRole(role, `SELECT * FROM public.job_reminder_kind('job_update', 'Starting soon', '')`);
  check(`${role} cannot call job_reminder_kind`, !!k.error, k.error ?? "allowed");
  const s = await asRole(role, `SELECT public.job_reminder_switched_off('${H2}', 'job_update', 'Starting soon', '')`);
  check(`${role} cannot call job_reminder_switched_off`, !!s.error, s.error ?? "allowed");
}
r = await asRole("authenticated", `SELECT count(*)::int AS n FROM public.job_reminder_types`);
check("authenticated can read the registry (the Settings section renders from it)", r.rows[0]?.n === 10, r.error ?? fmt(r.rows));
r = await asRole("anon", `SELECT count(*) FROM public.job_reminder_types`);
check("anon cannot read the registry", !!r.error, r.error ?? "allowed");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
