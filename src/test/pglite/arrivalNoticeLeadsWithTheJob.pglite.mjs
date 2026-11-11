#!/usr/bin/env node
/**
 * PGlite proof for 20261111194335_arrival_notice_leads_with_the_job.sql (F435): the poster's arrival notice title
 * leads with the job ("Mow two lawns: Yusef B. has arrived"); a long job title is cut to 21 characters and an
 * ellipsis; a blank title falls back to the old words; the message, the other branches and the grants do not move.
 *
 *   node src/test/pglite/arrivalNoticeLeadsWithTheJob.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/arrivalNoticeLeadsWithTheJob.pglite.mjs  # RED: the title as on prod
 *
 * World: notify_poster_on_status_change from its newest earlier migration on a trigger, granted the way Supabase's
 * default privileges do; then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261111194335_arrival_notice_leads_with_the_job.sql";
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
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (id uuid primary key, title text, customer_id uuid, helper_id uuid,
  status public.job_status default 'accepted', date_needed date, start_time time,
  helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  helper_completed_at timestamptz, proof_after_urls text[]);
CREATE TABLE public.job_continue_days (job_id uuid, new_date date, done_without_new_photo_at timestamptz, created_at timestamptz default now());
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- PGlite's clock ticks in milliseconds: two rows in one ms tie on created_at, so the proof orders by insert through a
-- fixture-only side table (notifications keeps only its real columns: pgliteNotificationsFixtureIsReal).
CREATE TABLE public.notice_insert_order (seq bigserial primary key, notification_id uuid);
CREATE FUNCTION public.note_notice_order() RETURNS trigger LANGUAGE plpgsql AS $o$
BEGIN INSERT INTO public.notice_insert_order (notification_id) VALUES (NEW.id); RETURN NEW; END $o$;
CREATE TRIGGER trg_note_notice_order AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.note_notice_order();
CREATE TABLE public.emails (user_id uuid, title text, message text, type text);
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid, g text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.send_notice_email(a uuid, b text, c text, d text, e text, f uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.emails VALUES (a, b, c, d) $$;
INSERT INTO profiles VALUES ('${P}','Pat Poster'),('${H}','Yusef Bell');
`);
await db.exec(newestBefore("notify_poster_on_status_change", MIG));
await db.exec(`GRANT EXECUTE ON FUNCTION public.notify_poster_on_status_change() TO anon, authenticated, service_role;
CREATE TRIGGER t AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_status_change();`);

if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
let n = 0;
async function job(title) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query(`INSERT INTO jobs (id, title, customer_id, helper_id, date_needed, start_time) VALUES ($1, $2, $3, $4, '2026-11-07', '09:00')`,
    [id, title, P, H]);
  return id;
}
const last = async (id) => (await db.query(`SELECT n.title, n.message, n.type FROM notifications n JOIN notice_insert_order o ON o.notification_id = n.id WHERE n.job_id = $1 ORDER BY o.seq DESC LIMIT 1`, [id])).rows[0];
const arrive = (id) => db.query(`UPDATE jobs SET helper_arrived_at = now() WHERE id = $1`, [id]);

const a = await job("Mow two lawns");
await arrive(a);
let r = await last(a);
check("arrival title leads with the job", r?.title === "Mow two lawns: Yusef B. has arrived", r);
check("arrival message unchanged", r?.message === 'Yusef B. has arrived for "Mow two lawns". Next: nothing for you to do; they mark it done when they finish.', r);
check("arrival type unchanged", r?.type === "transit_updates", r);
const em = (await db.query(`SELECT title FROM emails ORDER BY title`)).rows.map((x) => x.title);
check("arrival email carries the same title", em.includes("Mow two lawns: Yusef B. has arrived"), em);

const b = await job("Clean out the garage and the attic before Sunday");
await arrive(b);
r = await last(b);
check("a long job title is cut to 21 characters and an ellipsis", r?.title === "Clean out the garage…: Yusef B. has arrived", r);

const c = await job("   ");
await arrive(c);
r = await last(c);
check("a blank job title keeps the old words", r?.title === "Yusef B. has arrived", r);

const d = await job("Rake leaves");
await db.query(`UPDATE jobs SET helper_on_the_way_at = now() WHERE id = $1`, [d]);
r = await last(d);
check("on the way unchanged", r?.title === "Yusef B. is on the way", r);
await db.query(`UPDATE jobs SET helper_arrived_at = now() WHERE id = $1`, [d]);
await db.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [d]);
r = await last(d);
check("work has started unchanged", r?.title === "Work has started", r);

const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'notify_poster_on_status_change'`)).rows[0]?.a ?? "";
check("anon and authenticated cannot execute", !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), acl);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
