#!/usr/bin/env node
/**
 * PGlite proof for 20261103022806_departed_member_name_leaves_notifications.sql (Q2330).
 *
 *   node src/test/pglite/departedMemberNameLeavesNotifications.pglite.mjs                 # AFTER: migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/departedMemberNameLeavesNotifications.pglite.mjs  # RED: no trigger
 *
 * member_display_name is prod's body (md5 7e6b1e2703e0f1f606c70f7819516e0f, 2026-11-02). The purge is
 * driven by purge_user_data's step 4e UPDATE (full_name = NULL, anonymized_at = now(), guarded on
 * anonymized_at IS NULL; live body md5 9bdc2333246e6743528369812723952f), the one statement the
 * trigger keys on. Checks:
 *  - the departing poster's "First L." and full name leave the hired Helpr's, the applicant's and the
 *    crew member's notices for that job ("A former member" first, "a former member" mid-sentence);
 *  - the departing member as an applicant / crew member / hired Helpr is scrubbed from the poster's bell;
 *  - a notice with no job, or whose job does not name them, is left alone (a same-name member);
 *  - staff rows keep the name; a one-word name is left alone; a near name ("Bea Tz.") is left alone;
 *  - a second purge pass (retry) changes nothing; an unrelated profile edit changes nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(
  new URL("../../../supabase/migrations/20261103022806_departed_member_name_leaves_notifications.sql", import.meta.url).pathname,
  "utf8",
);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: no trigger (expect FAILs)");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BEA = U(1), HAL = U(2), APP = U(3), CREW = U(4), POSTER2 = U(5), BEA2 = U(6), ADMIN = U(7), MONO = U(8);
const J1 = U(91), J2 = U(92), J3 = U(93);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, phone text, anonymized_at timestamptz);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, link text,
    job_id uuid, read boolean DEFAULT false);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid);
  CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid, helper_id uuid);
  CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor'::text)
   RETURNS text
   LANGUAGE sql
   IMMUTABLE PARALLEL SAFE
   SET search_path TO ''
  AS $function$
    SELECT CASE
             WHEN v.t = '' THEN p_fallback
             WHEN array_length(v.parts, 1) > 1
               THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
             ELSE v.parts[1]
           END
      FROM (SELECT x.t,
                   regexp_split_to_array(x.t, '[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+') AS parts
              FROM (SELECT regexp_replace(coalesce(p_full_name, ''),
                                          '^[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$',
                                          '', 'g') AS t) x) v
  $function$;
  INSERT INTO public.profiles (user_id, full_name) VALUES
    ('${BEA}', 'Bea Thomas'), ('${HAL}', 'Hal Helpr'), ('${APP}', 'Ann Apply'), ('${CREW}', 'Cy Crew'),
    ('${POSTER2}', 'Pat Post'), ('${BEA2}', 'Bea Turner'), ('${ADMIN}', 'Ada Admin'), ('${MONO}', 'Will');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  -- J1: Bea posted, Hal hired, Ann applied, Cy on the crew. J2: Pat posted, Bea applied. J3: Pat posted, Bea2 hired.
  INSERT INTO public.jobs VALUES ('${J1}', '${BEA}', '${HAL}'), ('${J2}', '${POSTER2}', NULL), ('${J3}', '${POSTER2}', '${BEA2}');
  INSERT INTO public.applications (job_id, helper_id) VALUES ('${J1}', '${APP}'), ('${J2}', '${BEA}');
  INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${J1}', '${CREW}');
  INSERT INTO public.notifications (user_id, title, message, link, job_id) VALUES
    ('${HAL}',  'Bea T. hired you',          'Bea T. hired you for Yard work. Message Bea T. to plan.', '/jobs/1', '${J1}'),   -- 1
    ('${APP}',  'Offer update',              'Your offer to Bea T. was seen.',                          '/jobs/1', '${J1}'),   -- 2
    ('${CREW}', 'Crew',                      'Bea Thomas added you to the crew.',                       '/jobs/1', '${J1}'),   -- 3
    ('${POSTER2}', 'New applicant',          'Bea T. applied to Move a couch.',                         '/jobs/2', '${J2}'),   -- 4
    ('${POSTER2}', 'Your Helpr',             'Bea T. has arrived.',                                     '/jobs/3', '${J3}'),   -- 5 Bea2's job
    ('${HAL}',  'Hello',                     'Bea T. said hi.',                                         '/messages', NULL),    -- 6 no job
    ('${ADMIN}', 'Report',                   'Bea Thomas was reported.',                                '/admin?view=reports', '${J1}'), -- 7 staff
    ('${HAL}',  'Near name',                 'Bea Tz. and Bea Thomasina are someone else.',                                '/jobs/1', '${J1}'),   -- 8
    ('${BEA}',  'Own',                       'Bea T. your job is live.',                                '/jobs/1', '${J1}');   -- 9 her own (purge deletes)
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(MIG);

let fails = 0;
const ok = (cond, label) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) fails++;
};
const purge = (uid) =>
  db.query(`UPDATE public.profiles SET full_name = NULL, phone = NULL, anonymized_at = now()
             WHERE user_id = $1 AND anonymized_at IS NULL`, [uid]);
const row = async (id) => (await db.query(`SELECT title, message FROM public.notifications WHERE id = $1`, [id])).rows[0];

await db.query(`UPDATE public.profiles SET phone = '555' WHERE user_id = $1`, [BEA]);
ok((await row(1)).message.includes("Bea T."), "an ordinary profile edit leaves notices alone");

await purge(BEA);
let r = await row(1);
ok(r.title === "A former member hired you", `hired Helpr's title: ${r.title}`);
ok(r.message === "A former member hired you for Yard work. Message a former member to plan.", `hired Helpr's message: ${r.message}`);
ok((await row(2)).message === "Your offer to a former member was seen.", `applicant's notice: ${(await row(2)).message}`);
ok((await row(3)).message === "A former member added you to the crew.", `crew notice (full name): ${(await row(3)).message}`);
ok((await row(4)).message === "A former member applied to Move a couch.", `poster's notice of her application: ${(await row(4)).message}`);
ok((await row(5)).message === "Bea T. has arrived.", "a same-name member's job notice is left alone");
ok((await row(6)).message === "Bea T. said hi.", "a notice with no job is left alone");
ok((await row(7)).message === "Bea Thomas was reported.", "staff rows keep the name");
ok((await row(8)).message === "Bea Tz. and Bea Thomasina are someone else.", "a near name (Bea Tz., Bea Thomasina) is left alone");
ok((await row(9)).message === "Bea T. your job is live.", "her own row is not touched here (purge deletes it)");

const before = JSON.stringify((await db.query(`SELECT * FROM public.notifications ORDER BY id`)).rows);
await db.query(`UPDATE public.profiles SET anonymized_at = now() WHERE user_id = $1`, [BEA]); // retry pass
ok(JSON.stringify((await db.query(`SELECT * FROM public.notifications ORDER BY id`)).rows) === before, "a retry changes nothing");

await db.exec(`INSERT INTO public.notifications (user_id, title, message, link, job_id)
               VALUES ('${HAL}', 'Will', 'Will you confirm? Will T. is not this member.', '/jobs/1', '${J1}')`);
await db.query(`UPDATE public.jobs SET helper_id = $1 WHERE id = $2`, [MONO, J3]);
await purge(MONO);
ok((await db.query(`SELECT message FROM public.notifications WHERE title = 'Will'`)).rows[0].message.startsWith("Will you"), "a one-word name is left alone");

if (!SKIP) {
  const acl = (await db.query(`SELECT proacl::text a, prosecdef FROM pg_proc WHERE proname = 'scrub_departed_member_name_from_notifications'`)).rows[0];
  ok(acl.prosecdef && !/(^|[{,])(=|anon=|authenticated=)/.test(acl.a ?? ""), `definer, no EXECUTE for PUBLIC/anon/authenticated (${acl.a})`);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
