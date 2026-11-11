#!/usr/bin/env node
/**
 * PGlite proof for 20261111194802_thread_notices_name_the_job.sql (F443, job-name half):
 *   - a job's status row in a chat ("▶ Work started", is_system) gives a bell message that names the job;
 *   - a member's own message keeps its words; a job with no title keeps the old words;
 *   - the unread-message reminder names the job ("... waiting on your reply about "<job>". Next: ...") on both rungs.
 *
 *   node src/test/pglite/threadNoticesNameTheJob.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/threadNoticesNameTheJob.pglite.mjs  # RED: the words as on prod
 *
 * World: both functions from their newest earlier migrations (notify_message_recipient on a messages trigger), granted
 * the way Supabase's default privileges do; then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261111194802_thread_notices_name_the_job.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestBefore(fn, before) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f >= before) break;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const P = "11111111-1111-1111-1111-111111111111";
const H = "22222222-2222-2222-2222-222222222222";
const J1 = "00000000-0000-0000-0000-000000000001";
const J2 = "00000000-0000-0000-0000-000000000002";
const J3 = "00000000-0000-0000-0000-000000000003";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid primary key, title text);
CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), job_id uuid, sender_id uuid, receiver_id uuid,
  content text, attachment_url text, read boolean default false, is_system boolean default false, flagged_hidden boolean default false,
  team_thread_user_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.thread_mutes (user_id uuid, job_id uuid, other_user_id uuid, mute_until timestamptz);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null,
  type text, link text, job_id uuid, read boolean default false, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.notification_preferences (user_id uuid, message_preview boolean, email_messages boolean);
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE TABLE public.unread_message_reminder_sends (user_id uuid, message_id uuid, conversation text, rung smallint, sent_at timestamptz,
  PRIMARY KEY (user_id, message_id, rung));
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
CREATE FUNCTION public.unread_reminder_quiet(p_at timestamptz) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
INSERT INTO profiles VALUES ('${P}','Pat Poster'),('${H}','Yusef Bell');
-- Email off for both, so the trigger never reaches net.http_post (not in PGlite).
INSERT INTO notification_preferences VALUES ('${P}', true, false), ('${H}', true, false);
INSERT INTO jobs VALUES ('${J1}', 'Paint a fence'), ('${J2}', '  '), ('${J3}', 'Mow two lawns');
`);
await db.exec(newestBefore("notify_message_recipient", MIG));
await db.exec(newestBefore("sweep_unread_message_reminders", MIG));
await db.exec(`GRANT EXECUTE ON FUNCTION public.notify_message_recipient() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sweep_unread_message_reminders(timestamptz) TO anon, authenticated, service_role;
CREATE TRIGGER t AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_message_recipient();`);

if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
const bell = async (user, jobId) => (await db.query(
  `SELECT title, message FROM notifications WHERE user_id = $1 AND link LIKE $2 ORDER BY created_at DESC LIMIT 1`, [user, `%jobId=${jobId}%`])).rows[0];

await db.query(`INSERT INTO messages (job_id, sender_id, receiver_id, content, is_system) VALUES ($1, $2, $3, '▶ Work started', true)`, [J1, P, H]);
let r = await bell(H, J1);
check("status row names the job in the bell", r?.message === '▶ Work started: "Paint a fence"', r);
check("status row title unchanged (the sender's name)", r?.title === "Pat P.", r);

await db.query(`INSERT INTO messages (job_id, sender_id, receiver_id, content, is_system) VALUES ($1, $2, $3, 'See you at 9', false)`, [J3, P, H]);
r = await bell(H, J3);
check("a member's own words stay as written", r?.message === "See you at 9", r);

await db.query(`INSERT INTO messages (job_id, sender_id, receiver_id, content, is_system) VALUES ($1, $2, $3, '✓ Job awarded', true)`, [J2, P, H]);
r = await bell(H, J2);
check("a job with no title keeps the old words", r?.message === "✓ Job awarded", r);

// Unread reminders: a member message from H to P, 20 minutes old, unread.
await db.query(`DELETE FROM notifications`);
await db.query(`INSERT INTO messages (job_id, sender_id, receiver_id, content, created_at) VALUES ($1, $2, $3, 'Is the gate open?', '2026-11-11 15:00:00+00')`, [J1, H, P]);
await db.query(`INSERT INTO messages (job_id, sender_id, receiver_id, content, created_at) VALUES ($1, $2, $3, 'Here now', '2026-11-11 15:00:00+00')`, [J2, H, P]);
await db.query(`DELETE FROM notifications`);
await db.query(`SELECT public.sweep_unread_message_reminders('2026-11-11 15:20:00+00')`);
const rem = async (j) => (await db.query(`SELECT title, message FROM notifications WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`, [j])).rows[0];
r = await rem(J1);
check("reminder 1 names the job", r?.title === "Unread message" && r?.message === 'Yusef B. is waiting on your reply about "Paint a fence". Next: open the message and reply.', r);
r = await rem(J2);
check("reminder for a job with no title keeps the old words", r?.message === "Yusef B. is waiting on your reply. Next: open the message and reply.", r);
await db.query(`SELECT public.sweep_unread_message_reminders('2026-11-11 17:30:00+00')`);
r = await rem(J1);
check("reminder 2 names the job", r?.message === 'Yusef B. is still waiting on your reply about "Paint a fence". Next: open the message and reply.', r);

for (const fn of ["notify_message_recipient", "sweep_unread_message_reminders"]) {
  const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = $1`, [fn])).rows[0]?.a ?? "";
  check(`${fn}: anon and authenticated cannot execute`, !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), acl);
}

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
