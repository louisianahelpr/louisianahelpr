#!/usr/bin/env node
/**
 * PGlite proof for 20261102235342_no_time_job_notice_says_the_day_ended.sql (Q2640): a job with no start time that
 * auto-starts with no arrival tells the poster its day ended; a timed job keeps "Start time passed"; an arrival keeps
 * "Work has started"; the other branches and the grants do not move.
 *
 *   node src/test/pglite/noTimeJobNoticeDayEnded.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/noTimeJobNoticeDayEnded.pglite.mjs  # RED: the wording as on prod
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/noTimeJobNoticeDayEnded.pglite.mjs  # RED on a planted defect
 *
 * World: notify_poster_on_status_change from its newest earlier migration (20261102043115, prod's body by md5) on a
 * trigger, granted the way Supabase's default privileges do; then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261102235342_no_time_job_notice_says_the_day_ended.sql";
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
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.notification_preferences (user_id uuid, transit_updates boolean default true, work_status boolean default true);
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid, g text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
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
async function job(cols) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query(`INSERT INTO jobs (id, title, customer_id, helper_id, date_needed, start_time) VALUES ($1, $2, $3, $4, '2026-11-07', $5)`,
    [id, `Job ${n}`, P, H, cols.start_time ?? null]);
  return id;
}
const last = async (id) => (await db.query(`SELECT title, message FROM notifications WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];

// 1. No start time, auto-started with no arrival: the day ended.
const a = await job({});
await db.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [a]);
const ra = await last(a);
check("no start time, no arrival: title says the day ended", ra?.title === "Job day ended", ra);
check("no start time, no arrival: message names the Helpr and the day", ra?.message === `Yusef B. hasn't checked in for "Job 1", and its day is over. Open the job to message them or report a no-show.`, ra);
check("no start time: never 'Start time passed'", !/Start time passed/.test(`${ra?.title} ${ra?.message}`), ra);

// 2. A start time: word for word as before.
const b = await job({ start_time: "09:00" });
await db.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [b]);
const rb = await last(b);
check("timed job, no arrival: 'Start time passed' kept", rb?.title === "Start time passed" && rb?.message === `Yusef B. hasn't checked in for "Job 2". Open the job to message them or report a no-show.`, rb);

// 3. No start time, but the Helpr arrived (or the poster said so): work started.
const c = await job({});
await db.query(`UPDATE jobs SET helper_arrived_at = now() WHERE id = $1`, [c]);
await db.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [c]);
const rc = await last(c);
check("no start time, arrived: 'Work has started'", rc?.title === "Work has started", rc);
const d = await job({});
await db.query(`UPDATE jobs SET poster_confirmed_arrival_at = now(), status = 'in_progress' WHERE id = $1`, [d]);
check("no start time, poster confirmed arrival: 'Work has started'", (await last(d))?.title === "Work has started", await last(d));

// 4. Other branches unchanged.
const e = await job({});
await db.query(`UPDATE jobs SET helper_on_the_way_at = now() WHERE id = $1`, [e]);
check("on the way unchanged", (await last(e))?.message === `Yusef B. is heading to your job: "Job 5". Next: nothing for you to do until they arrive.`, await last(e));

// 5. Grants as live.
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'notify_poster_on_status_change'`)).rows[0]?.a ?? "";
check("anon and authenticated cannot execute", !/(^|,|\{)anon=/.test(acl) && !/authenticated=/.test(acl) && /service_role=X/.test(acl), acl);

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
