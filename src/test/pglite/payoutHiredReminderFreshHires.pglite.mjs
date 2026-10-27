#!/usr/bin/env node
/**
 * PGlite proof for 20261027154326_payout_hired_reminder_only_for_fresh_hires:
 * the "You're hired. Set up payouts" reminder (and its day1/day3/day7 nudges)
 * goes only for a live hire made in the last 24 h and after payout_after_hire
 * went live; the 'money' reminder is unchanged.
 * Per hire since the /code-review of the first cut: a repeat hire gets its own
 * 'hired', money reminders cannot crowd one out, a crew seat on a still-'open'
 * crew job counts.
 *
 *   node src/test/pglite/payoutHiredReminderFreshHires.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/payoutHiredReminderFreshHires.pglite.mjs # RED: prod's body (20261025162003)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Fixture: the objects the function reads, as prod has them (jobs.accepted_at,
 * group_job_helpers.joined_at, feature_switches.updated_at), and a
 * feature_enabled_for_user stub that answers true (both switches are
 * 'everyone' on prod since 2026-10-25 23:40:59Z). The "before" body is cut
 * from 20261025162003 (prod's, md5 58035927fcb6fd5ad587b76539caed44,
 * measured 2026-10-27).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261027154326_payout_hired_reminder_only_for_fresh_hires.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against prod's body (expect FAILs)`);

function cut(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, helper_id uuid, status text NOT NULL,
    payment_status text, accepted_at timestamptz);
  CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
    helper_id uuid NOT NULL, joined_at timestamptz);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean, is_seed boolean);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, updated_at timestamptz);
  CREATE TABLE public.payout_setup_reminders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL,
    reminder_key text NOT NULL, reminder_stage text NOT NULL, job_id uuid, claimed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (helper_id, reminder_key));
  CREATE FUNCTION public.feature_enabled_for_user(text, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  INSERT INTO public.feature_switches VALUES ('payout_after_hire', 'everyone', now() - interval '40 hours'),
                                             ('payout_setup', 'everyone', now() - interval '40 hours');
`);
await db.exec(cut("20261025162003_payout_after_hire.sql", "claim_payout_setup_reminders"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const claim = async () => (await db.query(`SELECT helper_id, reminder_key, stage, job_id FROM public.claim_payout_setup_reminders(100)`)).rows;
const forUid = (rows, uid) => rows.filter((r) => r.helper_id === uid);
const age = (uid, hours) => db.exec(`UPDATE public.payout_setup_reminders SET claimed_at = claimed_at - interval '${hours} hours' WHERE helper_id = '${uid}'`);
const sent = async (uid) => (await db.query(`SELECT reminder_stage s FROM public.payout_setup_reminders WHERE helper_id = '${uid}' ORDER BY claimed_at`)).rows.map((r) => r.s);
const stages = (rows, uid) => forUid(rows, uid).map((r) => `${r.stage}:${r.job_id}`).join();

// Go-live as on prod: 2026-10-25 23:40:59Z. "now" in this proof is the real
// clock (2026-10-27 or later), so hire times are set relative to go-live.
const GO = "timestamptz '2026-10-25 23:40:59+00'";
const OWNER_CASE = u(1), FRESH = u(2), STALE = u(3), PRE_LAUNCH = u(4), CREW = u(5), NO_TIME = u(6), BUSY = u(7);
for (const h of [OWNER_CASE, FRESH, STALE, PRE_LAUNCH, CREW, NO_TIME, BUSY]) await db.exec(`INSERT INTO public.profiles VALUES ('${h}', NULL, NULL, false)`);
await db.exec(`
  -- The owner's report: hired 2026-10-08, COMPLETED, payout held.
  INSERT INTO public.jobs VALUES ('${u(101)}', 'Assemble an IKEA dresser', '${OWNER_CASE}', 'completed', 'payout_pending', timestamptz '2026-10-08 23:38:49+00');
  -- A hire made 2 hours ago, in escrow.
  INSERT INTO public.jobs VALUES ('${u(102)}', 'Fresh hire', '${FRESH}', 'accepted', 'escrow', now() - interval '2 hours');
  -- Live, after go-live, but hired 4 days ago and never reminded (outside 72 h).
  INSERT INTO public.jobs VALUES ('${u(103)}', 'Stale live hire', '${STALE}', 'in_progress', 'escrow', now() - interval '4 days');
  -- Live, hired 1 minute BEFORE go-live.
  INSERT INTO public.jobs VALUES ('${u(104)}', 'Pre-launch hire', '${PRE_LAUNCH}', 'accepted', 'escrow', ${GO} - interval '1 minute');
  -- A crew seat taken 1 hour ago on a funded crew job still 'open' (other seats filling).
  INSERT INTO public.jobs VALUES ('${u(105)}', 'Crew job', NULL, 'open', 'escrow', NULL);
  INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at) VALUES ('${u(105)}', '${CREW}', now() - interval '1 hour');
  -- A live hire with no recorded hire time.
  INSERT INTO public.jobs VALUES ('${u(106)}', 'No time', '${NO_TIME}', 'accepted', 'escrow', NULL);
  -- A Helpr with two held payouts AND a new hire 2 hours ago.
  INSERT INTO public.jobs VALUES ('${u(107)}', 'Held A', '${BUSY}', 'completed', 'payout_pending', ${GO} - interval '5 days');
  INSERT INTO public.jobs VALUES ('${u(108)}', 'Held B', '${BUSY}', 'completed', 'payout_pending', ${GO} - interval '5 days');
  INSERT INTO public.jobs VALUES ('${u(109)}', 'Busy new hire', '${BUSY}', 'accepted', 'escrow', now() - interval '2 hours');
`);

let rows = await claim();
check("the owner's case: a completed job's held pay gets its 'money' reminder", forUid(rows, OWNER_CASE).map((r) => r.stage).join() === "money");
check("a hire made 2 h ago gets 'hired', naming that job", stages(rows, FRESH) === `hired:${u(102)}`);
check("a crew seat taken 1 h ago on a still-'open' crew job gets 'hired'", stages(rows, CREW) === `hired:${u(105)}`, stages(rows, CREW));
check("a live hire made 4 days ago, never reminded, gets no 'hired'", forUid(rows, STALE).length === 0, stages(rows, STALE));
check("a hire made before payout_after_hire went live gets no 'hired'", forUid(rows, PRE_LAUNCH).length === 0, stages(rows, PRE_LAUNCH));
check("a hire with no recorded hire time gets no 'hired'", forUid(rows, NO_TIME).length === 0);

// The next day (2026-10-26 20:09Z in the report).
await age(OWNER_CASE, 21);
rows = await claim();
check("the owner's case, the next day: NO 'hired' for a job completed 18 days after its hire", forUid(rows, OWNER_CASE).length === 0, stages(rows, OWNER_CASE));
for (const h of [25, 50, 100]) { await age(OWNER_CASE, h); await claim(); }
check("...nor any day1/day3/day7 afterwards", (await sent(OWNER_CASE)).join() === "money", (await sent(OWNER_CASE)).join());

// Prod's own 'hired' row (key 'hired', job 9c6ff2de completed): nothing follows.
await db.exec(`INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, reminder_stage, job_id, claimed_at)
               VALUES ('${OWNER_CASE}', 'hired', 'hired', '${u(101)}', now() - interval '5 days') ON CONFLICT DO NOTHING`);
for (const h of [25, 50, 100]) { await age(OWNER_CASE, h); await claim(); }
check("prod's existing 'hired' row on the completed job: no day1/day3/day7 follow", (await sent(OWNER_CASE)).join() === "money,hired", (await sent(OWNER_CASE)).join());

// Money first, then the new hire's 'hired' still goes (72 h, per hire).
// (its first run, above, already sent money for one held job)
for (let i = 0; i < 2; i++) { await age(BUSY, 21); await claim(); }
check("two held payouts then a fresh hire: money, money, then 'hired' (not crowded out)", (await sent(BUSY)).join() === "money,money,hired", (await sent(BUSY)).join());

// A completed hire gets no nudges; a repeat hire gets its own 'hired'.
await db.exec(`UPDATE public.jobs SET status = 'completed' WHERE id = '${u(102)}'`);
for (const h of [25, 50, 100]) { await age(FRESH, h); await claim(); }
check("a 'hired' Helpr whose job completed gets no day1/day3/day7", (await sent(FRESH)).join() === "hired", (await sent(FRESH)).join());
await db.exec(`INSERT INTO public.jobs VALUES ('${u(110)}', 'Second hire', '${FRESH}', 'in_progress', 'escrow', now() - interval '1 hour')`);
rows = await claim();
check("the same Helpr hired again gets a new 'hired' for that job, not a stray day7", stages(rows, FRESH) === `hired:${u(110)}`, stages(rows, FRESH));

// A live crew seat: day1, day3, day7 from its own 'hired', also while the job is in revision.
await age(CREW, 25); rows = await claim();
check("a live crew hire: day1 a day later", stages(rows, CREW) === `day1:${u(105)}`, stages(rows, CREW));
await db.exec(`UPDATE public.jobs SET status = 'revision_requested' WHERE id = '${u(105)}'`);
await age(CREW, 50); rows = await claim();
check("...day3 (still hired during a revision)", stages(rows, CREW) === `day3:${u(105)}`, stages(rows, CREW));
await age(CREW, 100); rows = await claim();
check("...day7", stages(rows, CREW) === `day7:${u(105)}`, stages(rows, CREW));
await age(CREW, 48);
check("...and nothing after day 7", forUid(await claim(), CREW).length === 0);

if (!MODE) {
  const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.claim_payout_setup_reminders(integer)', 'EXECUTE') a,
                                      has_function_privilege('anon', 'public.claim_payout_setup_reminders(integer)', 'EXECUTE') b`)).rows[0];
  check("service role only", !acl.a && !acl.b, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
