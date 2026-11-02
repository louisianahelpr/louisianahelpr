#!/usr/bin/env node
/**
 * PGlite proof for 20261102043115_job_notices_say_the_next_step.sql (audit 11-01 A3-36, A3-37, A3-38): the poster's
 * status notices, the poster's "New application" notice and the Helpr's "Job funded" notice end with the next step
 * and its deadline in Louisiana time; nothing else in the three senders moves.
 *
 *   node src/test/pglite/jobNoticesNextStep.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/jobNoticesNextStep.pglite.mjs  # RED: the wording as on prod
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/jobNoticesNextStep.pglite.mjs  # RED on a planted defect
 *
 * World: the three functions from their newest earlier migration, then 20261030220537's in-place literal rewrite (that
 * is what prod runs, md5-checked in the migration header), granted to anon and authenticated the way Supabase's
 * default privileges do; then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261102043115_job_notices_say_the_next_step.sql";
const REWRITE = "20261030220537_notices_say_no_escrow.sql";
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

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // Helpr (Yusef Bell)
const A2 = "33333333-3333-3333-3333-333333333333"; // second applicant
const J = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls (id serial, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(body) VALUES (body) RETURNING id::bigint $$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (id uuid primary key, title text, customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
  direct_offer_status text, category text, payment_status text, is_seed boolean default false, is_group_job boolean default false,
  status public.job_status default 'open', date_needed date, start_time time, expires_at timestamptz,
  helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  helper_completed_at timestamptz, proof_after_urls text[], helper_confirmed_at timestamptz);
CREATE TABLE public.job_applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text, decline_reason text);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text, job_id uuid);
CREATE TABLE public.notification_preferences (user_id uuid, email_job_applications boolean default true, financial_alerts boolean default true,
  transit_updates boolean default true, work_status boolean default true);
CREATE TABLE public.profiles (user_id uuid, full_name text, email text);
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.application_email_should_wait(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid, g text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.job_category_group(c text) RETURNS text LANGUAGE sql AS $$ SELECT c $$;
INSERT INTO profiles VALUES ('${P}','Pat Poster','p@x.test'),('${H}','Yusef Bell','h@x.test'),('${A2}','Ana Cruz','a@x.test');
`);
const FNS = ["notify_poster_on_status_change", "notify_on_application", "notify_on_payment_escrowed"];
// The definitions prod runs: the newest CREATE before the rewrite, then the rewrite (idempotent on what it already has).
for (const fn of FNS) await db.exec(newestBefore(fn, REWRITE));
await db.exec(readFileSync(`${dir}${REWRITE}`, "utf8"));
// Supabase's default privileges grant EXECUTE on every new public function to anon and authenticated.
for (const fn of FNS) await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn}() TO anon, authenticated, service_role`);

if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };
const last = async (uid) => (await q(`select title, message, link, type from notifications where user_id=$1 order by ctid desc limit 1`, [uid]))[0];

await db.exec(`
CREATE TRIGGER s AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_status_change();
CREATE TRIGGER p AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();
CREATE TRIGGER a AFTER INSERT OR UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();
`);

// ── A3-37: New application ── a job on Sat Nov 16 2030 at 9:00 AM (CST), listing closing 14 days later.
await db.exec(`INSERT INTO jobs(id,title,customer_id,category,payment_status,date_needed,start_time,expires_at)
  VALUES ('${J}','Mow two lawns','${P}','yard_work','held','2030-11-16','09:00','2030-11-30T15:00:00Z')`);
await db.exec(`INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${H}','pending')`);
let n = await last(P);
check("A3-37: the poster's notice names the applicant and the next step with the start as the pick-by",
  n?.message === 'Yusef B. applied to "Mow two lawns". Next: review and pick a Helpr before it starts Sat, Nov 16 at 9:00 AM.', n?.message);
check("A3-37: title, type and link unchanged", n?.title === "New application" && n?.type === "application" && n?.link === `/posts?job=${J}`, JSON.stringify(n));
const mail = (await q(`select body from net.calls order by id desc limit 1`))[0]?.body;
check("A3-37: the email carries the same sentence", mail?.message === n?.message, JSON.stringify(mail));

await db.exec(`UPDATE jobs SET start_time=NULL WHERE id='${J}'; INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${A2}','pending')`);
n = await last(P);
check("A3-37: a start with no time picks by that day", /^Ana C\. applied to "Mow two lawns"\. Next: review and pick a Helpr before Sat, Nov 16\.$/.test(n?.message ?? ""), n?.message);

await db.exec(`UPDATE jobs SET start_time='09:00', expires_at='2030-11-14T18:00:00Z' WHERE id='${J}'; DELETE FROM job_applications WHERE helper_id='${A2}'; INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${A2}','pending')`);
n = await last(P);
check("A3-37: a close before the start is the pick-by", /Next: review and pick a Helpr by Thu, Nov 14 at 12:00 PM\.$/.test(n?.message ?? ""), n?.message);

await db.exec(`UPDATE jobs SET date_needed='2020-01-04', expires_at='2020-01-18T15:00:00Z' WHERE id='${J}'; DELETE FROM job_applications WHERE helper_id='${A2}'; INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${A2}','pending')`);
n = await last(P);
check("A3-37: past both, no date is promised", n?.message === 'Ana C. applied to "Mow two lawns". Next: review and pick a Helpr.', n?.message);

await db.exec(`UPDATE jobs SET date_needed='2030-11-16', start_time='09:00', expires_at='2030-11-30T15:00:00Z' WHERE id='${J}'`);
// The rejected branch is unchanged.
await db.exec(`UPDATE job_applications SET status='rejected' WHERE helper_id='${A2}'`);
n = await last(A2);
check("unchanged: the not-picked notice", n?.title === "Not picked this time" && /Tap to see similar open jobs\.$/.test(n?.message ?? ""), JSON.stringify(n));

// ── A3-38: Job funded ── confirm by 2 h before the start: Sat Nov 16 at 7:00 AM.
await db.exec(`DELETE FROM notifications; UPDATE jobs SET helper_id='${H}', status='accepted' WHERE id='${J}'; UPDATE jobs SET payment_status='escrow' WHERE id='${J}'`);
n = await last(H);
check("A3-38: Job funded names the confirm step and its deadline",
  n?.title === "Job funded" && n?.message === 'Payment for "Mow two lawns" is held. Next: confirm you\'ll be there by Sat, Nov 16 at 7:00 AM.', n?.message);
check("A3-38: no Get to work", !/Get to work/.test(n?.message ?? ""), n?.message);
n = await last(P);
check("unchanged: the poster's Payment secured", n?.title === "Payment secured" && /is safely held and will be released after the job is completed\.$/.test(n?.message ?? ""), JSON.stringify(n));

await db.exec(`DELETE FROM notifications; UPDATE jobs SET payment_status='held', helper_confirmed_at=now() WHERE id='${J}'; UPDATE jobs SET payment_status='escrow' WHERE id='${J}'`);
n = await last(H);
check("A3-38: already confirmed, no next step", n?.message === 'Payment for "Mow two lawns" is held.', n?.message);

await db.exec(`DELETE FROM notifications; UPDATE jobs SET payment_status='held', helper_confirmed_at=NULL, date_needed=(now() AT TIME ZONE 'America/Chicago')::date, start_time=((now() AT TIME ZONE 'America/Chicago') + interval '1 hour')::time WHERE id='${J}'; UPDATE jobs SET payment_status='escrow' WHERE id='${J}'`);
n = await last(H);
const nearMidnight = new Date(Date.now() + 3600e3).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }) === "0";
check("A3-38: a confirm deadline already passed is never promised", nearMidnight || n?.message === 'Payment for "Mow two lawns" is held.', n?.message);

await db.exec(`DELETE FROM notifications; UPDATE jobs SET payment_status='released' WHERE id='${J}'`);
n = await last(H);
check("unchanged: Payout released", n?.title === "Payout released", JSON.stringify(n));

// ── A3-36: the poster's status notices.
await db.exec(`UPDATE jobs SET date_needed='2030-11-16', start_time='09:00', status='accepted' WHERE id='${J}'; DELETE FROM notifications`);
await db.exec(`UPDATE jobs SET helper_on_the_way_at='2030-11-16T14:40:00Z' WHERE id='${J}'`);
n = await last(P);
check("A3-36: on the way says there is nothing to do yet",
  n?.title === "Yusef B. is on the way" && n?.message === 'Yusef B. is heading to your job: "Mow two lawns". Next: nothing for you to do until they arrive.', n?.message);
await db.exec(`UPDATE jobs SET helper_arrived_at='2030-11-16T15:00:00Z' WHERE id='${J}'`);
n = await last(P);
check("A3-36: arrived says who acts next",
  n?.message === 'Yusef B. has arrived for "Mow two lawns". Next: nothing for you to do; they mark it done when they finish.', n?.message);
await db.exec(`UPDATE jobs SET status='in_progress' WHERE id='${J}'`);
n = await last(P);
check("unchanged: Work has started", n?.title === "Work has started", JSON.stringify(n));

// Done Tue Nov 12 2030 4:30 PM CST (22:30Z): approve by Wed Nov 13 at 4:30 PM.
await db.exec(`UPDATE jobs SET helper_completed_at='2030-11-12T22:30:00Z', proof_after_urls=ARRAY['a.jpg','',NULL,'b.jpg'] WHERE id='${J}'`);
n = await last(P);
check("A3-36: done with photos names the approval deadline",
  n?.title === "Yusef B. marked the job complete"
  && n?.message === 'Yusef B. finished "Mow two lawns" and added 2 after photos. Next: review them and approve by Wed, Nov 13 at 4:30 PM, or Helpr support steps in.', n?.message);
await db.exec(`UPDATE jobs SET helper_completed_at=NULL WHERE id='${J}'; UPDATE jobs SET helper_completed_at='2030-11-12T22:30:00Z', proof_after_urls=NULL WHERE id='${J}'`);
n = await last(P);
check("A3-36: done without photos names the approval deadline",
  n?.message === 'Yusef B. has finished "Mow two lawns". Next: check the work and approve by Wed, Nov 13 at 4:30 PM, or Helpr support steps in.', n?.message);
check("unchanged: the done link and type", n?.link === `/posts?job=${J}` && n?.type === "work_status", JSON.stringify(n));

// Preference off still skips.
await db.exec(`INSERT INTO notification_preferences(user_id, transit_updates) VALUES ('${P}', false); DELETE FROM notifications; UPDATE jobs SET helper_on_the_way_at='2030-11-16T14:45:00Z' WHERE id='${J}'`);
check("unchanged: transit_updates off sends nothing", (await q(`select 1 from notifications where user_id=$1`, [P])).length === 0);

// Grants: service_role only, even after Supabase's default anon/authenticated grant.
for (const fn of FNS) {
  const acl = String((await q(`select proacl::text a from pg_proc where proname=$1`, [fn]))[0]?.a ?? "");
  check(`${fn}: no anon or authenticated execute`, !/(^|[{,])anon=/.test(acl) && !/(^|[{,])authenticated=/.test(acl) && /service_role=X/.test(acl), acl);
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL PASS (${results.length})`);
process.exit(failed ? 1 : 0);
