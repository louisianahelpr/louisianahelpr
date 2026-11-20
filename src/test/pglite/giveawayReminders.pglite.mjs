#!/usr/bin/env node
/**
 * PGlite proof for 20261119200128 (owner 11-19): 25 Days of Louisiana Giveaways reminder pushes. Each due reminder in
 * public.giveaway_reminders goes once per member, as a giveaway_reminders notice linking to /25days; never twice; never
 * to a member who turned Giveaway reminders off, a test or seed account, or a banned one; nothing at all while the
 * sponsor_25days switch is off; never before send_at or more than 6 hours after it. giveaway_entry_url() answers the
 * configured link only while the switch is on.
 *
 *   node src/test/pglite/giveawayReminders.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giveawayReminders.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                # each must FAIL (see MUTANTS)
 *
 * World: cut-down tables carrying the columns the sweep reads. Stubbed, and said so: is_test_subject = a test_accounts
 * list (its own proof: adminAlertsSkipTestAccounts.pglite.mjs); sponsor_25days_on_for = audience 'everyone', or
 * 'testers' and the member is in a testers list (the real one asks feature_enabled_for_user); auth.uid() = NULL.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_giveaway_reminders.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  noDedupe: ["      ON CONFLICT (reminder_key, user_id) DO NOTHING\n", "      ON CONFLICT (reminder_key, user_id) DO UPDATE SET sent_at = now()\n"],
  noOptOut: ["       WHERE np.giveaway_reminders IS NOT FALSE\n", "       WHERE true\n"],
  seedTold: ["         AND p.is_seed IS NOT TRUE\n", ""],
  testTold: ["         AND NOT public.is_test_subject(p.user_id)\n", ""],
  bannedTold: ["         AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))\n", ""],
  permBannedTold: ["'temp_banned', 'permanently_banned'))\n", "'temp_banned'))\n"],
  noSwitch: ["  IF NOT EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'sponsor_25days' AND s.audience IS DISTINCT FROM 'off') THEN", "  IF false THEN"],
  noPerMember: ["         AND (v_everyone OR public.sponsor_25days_on_for(p.user_id))\n", ""],
  everyoneAlways: ["  v_everyone := EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'sponsor_25days' AND s.audience = 'everyone');", "  v_everyone := true;"],
  noLateStop: ["AND g.send_at > now() - interval '6 hours'", ""],
  early: ["     WHERE g.send_at <= now() AND", "     WHERE"],
  defaultOff: ["giveaway_reminders boolean NOT NULL DEFAULT true;", "giveaway_reminders boolean NOT NULL DEFAULT false;"],
  urlWhileOff: ["  SELECT CASE WHEN public.sponsor_25days_on_for((SELECT auth.uid()))", "  SELECT CASE WHEN true"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ANN = U(1), BEN = U(2), OFF = U(3), SEED = U(4), TEST = U(5), BANNED = U(6), NOPREFS = U(7), ADMIN = U(8), PERM = U(9);

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY REFERENCES auth.users(id), is_seed boolean NOT NULL DEFAULT false, ban_status text);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p) $f$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL);
  CREATE TABLE public.testers (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.sponsor_25days_on_for(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
    SELECT COALESCE((SELECT s.audience = 'everyone' FROM public.feature_switches s WHERE s.key = 'sponsor_25days'), false)
        OR (COALESCE((SELECT s.audience = 'testers' FROM public.feature_switches s WHERE s.key = 'sponsor_25days'), false)
            AND EXISTS (SELECT 1 FROM public.testers t WHERE t.user_id = p)) $f$;
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
  CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK (type IN ('info')));
  CREATE TABLE public.sponsor_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), max_per_day integer);
  INSERT INTO public.sponsor_settings (id) VALUES (true);
  INSERT INTO public.feature_switches VALUES ('sponsor_25days', 'off');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

const q = async (sql) => (await db.query(sql)).rows;
const safe = async (sql) => { try { return await q(sql); } catch (e) { return { error: String(e.message ?? e) }; } };

await db.exec(`
  INSERT INTO auth.users (id) VALUES ('${ANN}'), ('${BEN}'), ('${OFF}'), ('${SEED}'), ('${TEST}'), ('${BANNED}'), ('${NOPREFS}'), ('${ADMIN}'), ('${PERM}');
  INSERT INTO public.profiles (user_id, is_seed, ban_status) VALUES ('${ANN}', false, NULL), ('${BEN}', false, 'final_warning'),
    ('${OFF}', false, NULL), ('${SEED}', true, NULL), ('${TEST}', false, NULL), ('${BANNED}', false, 'banned'),
    ('${NOPREFS}', false, NULL), ('${ADMIN}', false, NULL), ('${PERM}', false, 'permanently_banned');
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  INSERT INTO public.testers VALUES ('${ADMIN}'), ('${TEST}');
`);
await safe(`INSERT INTO public.notification_preferences (user_id) VALUES ('${ANN}'), ('${BEN}'), ('${OFF}'), ('${SEED}'), ('${TEST}'), ('${BANNED}'), ('${ADMIN}')`);
await safe(`UPDATE public.notification_preferences SET giveaway_reminders = false WHERE user_id = '${OFF}'`);

// The config, as seeded: the owner's dates (Louisiana time) and words.
const rows = await safe(`SELECT key, to_char(send_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') AS at, title, message, link
  FROM public.giveaway_reminders ORDER BY send_at`);
const seeded = Array.isArray(rows) ? rows.map((r) => `${r.at} ${r.message} ${r.link}`) : [];
check(JSON.stringify(seeded) === JSON.stringify([
  "2026-11-30 18:00 🎄 25 Days of Louisiana Giveaways starts tomorrow! Enter once for a chance at all 25 days. Tap to see how. /25days",
  "2026-12-01 09:00 It's here! Enter once and you're in for all 25 days of Louisiana giveaways 🎁 /25days",
  "2026-12-05 18:00 It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left. /25days",
  "2026-12-10 18:00 It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left. /25days",
  "2026-12-15 18:00 It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left. /25days",
  "2026-12-19 18:00 It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left. /25days",
  "2026-12-23 18:00 Last chance! Only a few days of giveaways left 🎄 /25days",
]), "seeded schedule and copy are the owner's, in Louisiana time");

// Make one reminder due now, one 7 hours past (too late), one in an hour (too early); the rest stay in December.
await safe(`UPDATE public.giveaway_reminders SET send_at = now() - interval '1 minute' WHERE key = 'starts_tomorrow'`);
await safe(`UPDATE public.giveaway_reminders SET send_at = now() - interval '7 hours' WHERE key = 'its_here'`);
await safe(`UPDATE public.giveaway_reminders SET send_at = now() + interval '1 hour' WHERE key = 'last_chance'`);
const sweep = () => safe(`SELECT public.giveaway_reminder_sweep() AS r`);
const told = async () => {
  const r = await safe(`SELECT user_id, type, link, message FROM public.notifications ORDER BY user_id`);
  return Array.isArray(r) ? r : [];
};

// Switch off: nothing to anyone.
const off = await sweep();
check(!off.error && (await told()).length === 0, "switch off: nothing is sent");
check(!off.error && off[0]?.r?.skipped === "switch_off", "switch off: the run says why");

// Testers: only a tester who is not a test account (an admin).
await db.exec(`UPDATE public.feature_switches SET audience = 'testers'`);
await sweep();
let t = await told();
check(t.length === 1 && t[0].user_id === ADMIN, "switch on for Testers: only the admin tester (the test account is excluded)");

// Everyone.
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone'`);
const first = await sweep();
t = await told();
const ids = new Set(t.map((r) => r.user_id));
check(ids.has(ANN) && ids.has(BEN) && ids.has(NOPREFS), "every real member is told, with or without a preferences row");
check(!ids.has(OFF), "a member who turned Giveaway reminders off is not told");
check(!ids.has(SEED), "a seed account is not told");
check(!ids.has(TEST), "a test account is not told");
check(!ids.has(BANNED), "a banned member is not told");
check(!ids.has(PERM), "a permanently banned member is not told");
check(t.length === 4, `exactly 4 notices (admin + 3 members), got ${t.length}`);
check(t.every((r) => r.type === "giveaway_reminders" && r.link === "/25days"), "type giveaway_reminders, links to /25days");
check(t.every((r) => r.message.startsWith("🎄 25 Days")), "only the due reminder went (not the 7-hours-late or the early one)");
check(!first.error && first[0]?.r?.sent === 3, "the run counts what it sent");

// Again: once per member.
await sweep();
await sweep();
check((await told()).length === 4, "a second and third run send nothing more (once per member)");

// The pref map row and the switch default.
const map = await safe(`SELECT pref_column FROM public.notification_type_pref_map WHERE type = 'giveaway_reminders'`);
check(Array.isArray(map) && map[0]?.pref_column === "giveaway_reminders", "notification_type_pref_map points push at giveaway_reminders");
const cols = await safe(`SELECT column_name, column_default FROM information_schema.columns
  WHERE table_name = 'notification_preferences' AND column_name IN ('giveaway_reminders', 'email_giveaway_reminders') ORDER BY 1`);
check(Array.isArray(cols) && cols.find((c) => c.column_name === "giveaway_reminders")?.column_default === "true"
  && cols.find((c) => c.column_name === "email_giveaway_reminders")?.column_default === "false", "push ON by default, email OFF");

// The entry link.
await safe(`UPDATE public.sponsor_settings SET entry_url = 'https://www.facebook.com/louisianahelpr/posts/1'`);
const url = await safe(`SELECT public.giveaway_entry_url() AS u`);
check(Array.isArray(url) && url[0]?.u === "https://www.facebook.com/louisianahelpr/posts/1", "giveaway_entry_url answers the configured link");
await db.exec(`UPDATE public.feature_switches SET audience = 'off'`);
const urlOff = await safe(`SELECT public.giveaway_entry_url() AS u`);
check(Array.isArray(urlOff) && urlOff[0]?.u === null, "giveaway_entry_url answers nothing while the switch is off");
const bad = await safe(`UPDATE public.sponsor_settings SET entry_url = 'javascript:alert(1)'`);
check(!!bad.error, "entry_url must be an https link");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
