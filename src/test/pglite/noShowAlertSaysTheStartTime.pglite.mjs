#!/usr/bin/env node
/**
 * PGlite proof for 20261029173937_no_show_alert_says_the_start_time (audit 2026-10-29 A2-C40).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/noShowAlertSaysTheStartTime.pglite.mjs
 *
 * A minimal schema (the columns sweep_no_show_alerts reads), then:
 *   OLD STATE: the newest body before this migration (20260927012241) is loaded and run once: its poster
 *   message says "30 minutes ago", "your helpr" and "mark this as a no-show" (printed, RED by design).
 *   NEW STATE: the migration is applied 3x (replay-safe) and the sweep run on a one-off job and a crew job
 *   whose start was 40 minutes ago: every message names the start time, "Helpr" is capitalized, nothing points
 *   at a no-show; the once-only stamp still holds (a second run sends nothing); anon/authenticated cannot run it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261029173937_no_show_alert_says_the_start_time.sql");
const OLD_FILE = mig("20260927012241_group_crew_reminders_and_counts.sql");
const oldStart = OLD_FILE.indexOf("CREATE OR REPLACE FUNCTION public.sweep_no_show_alerts()");
const OLD = OLD_FILE.slice(oldStart, OLD_FILE.indexOf("$$;", oldStart) + 3);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text, is_group_job boolean DEFAULT false,
    start_time time, date_needed date, no_show_alert_sent_at timestamptz);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
  CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text, read boolean, job_id uuid);
  CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
`);

// A start 40 minutes ago in Louisiana time, as date + time columns.
const seed = async () => {
  await db.exec(`DELETE FROM public.notifications; DELETE FROM public.jobs; DELETE FROM public.group_job_helpers;`);
  await db.exec(`
    INSERT INTO public.jobs (id, title, customer_id, helper_id, status, is_group_job, start_time, date_needed)
    SELECT '00000000-0000-0000-0000-0000000000a1', 'Rake the yard', '00000000-0000-0000-0000-0000000000c1',
           '00000000-0000-0000-0000-0000000000e1', 'accepted', false,
           ((now() - interval '40 minutes') AT TIME ZONE 'America/Chicago')::time(0),
           ((now() - interval '40 minutes') AT TIME ZONE 'America/Chicago')::date;
    INSERT INTO public.jobs (id, title, customer_id, helper_id, status, is_group_job, start_time, date_needed)
    SELECT '00000000-0000-0000-0000-0000000000a2', 'Move a couch', '00000000-0000-0000-0000-0000000000c1',
           NULL, 'accepted', true,
           ((now() - interval '40 minutes') AT TIME ZONE 'America/Chicago')::time(0),
           ((now() - interval '40 minutes') AT TIME ZONE 'America/Chicago')::date;
    INSERT INTO public.group_job_helpers VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', NULL);
  `);
};

// OLD STATE (RED by design): what the poster was told.
await db.exec(OLD);
await seed();
await db.query(`SELECT public.sweep_no_show_alerts()`);
const oldMsg = (await db.query(`SELECT title, message FROM public.notifications WHERE type = 'job_update' AND link LIKE '/jobs/%'`)).rows[0];
console.log(`-- OLD STATE (20260927012241) RED: ${JSON.stringify(oldMsg)}`);
check("old body is the broken copy (sanity)", /30 minutes ago/.test(oldMsg?.message ?? "") && /no-show/.test(oldMsg?.message ?? ""));

// NEW STATE: apply 3x.
let applied = 0;
for (let i = 0; i < 3; i++) {
  try { await db.exec(NEW); applied++; } catch (e) { console.log(`apply ${i + 1} failed: ${e.message}`); }
}
check("applies 3x (replay-safe)", applied === 3);

await seed();
const pushed = (await db.query(`SELECT public.sweep_no_show_alerts() AS n`)).rows[0].n;
check("the sweep sends the four messages (poster + Helpr, one-off + crew)", pushed === 4, `pushed ${pushed}`);
const rows = (await db.query(`SELECT title, message FROM public.notifications ORDER BY message`)).rows;
const startLabel = (await db.query(`SELECT to_char(start_time, 'FMHH12:MI AM') AS t FROM public.jobs LIMIT 1`)).rows[0].t;
check("every message names the start time", rows.length === 4 && rows.every((r) => r.message.includes(`start at ${startLabel}`)), startLabel);
check("no '30 minutes ago'", rows.every((r) => !/minutes ago/.test(r.message)));
check("'Helpr' capitalized everywhere", rows.every((r) => !/\bhelpr\b/.test(`${r.title} ${r.message}`)));
check("nothing points at a no-show", rows.every((r) => !/no-show/i.test(r.message)));
check("the poster's one-off title", rows.some((r) => r.title === "Has your Helpr arrived?"));
const again = (await db.query(`SELECT public.sweep_no_show_alerts() AS n`)).rows[0].n;
check("once only: a second run sends nothing", again === 0, `pushed ${again}`);
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.sweep_no_show_alerts()', 'EXECUTE') AS a,
                                   has_function_privilege('authenticated', 'public.sweep_no_show_alerts()', 'EXECUTE') AS u`)).rows[0];
check("anon and authenticated cannot run it", !acl.a && !acl.u, JSON.stringify(acl));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
