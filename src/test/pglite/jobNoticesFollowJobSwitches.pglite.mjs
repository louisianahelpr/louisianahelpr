#!/usr/bin/env node
/**
 * PGlite proof for the job notice migration (list #17).
 *
 *   node src/test/pglite/jobNoticesFollowJobSwitches.pglite.mjs                 # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/jobNoticesFollowJobSwitches.pglite.mjs   # RED: the bug as on prod
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). sms_kind_for starts from its prod body
 * (20261030035326, md5 2adba759... on prod 2026-10-30). The pref map, the push gate and the SMS fan-out are the prod
 * rows reduced to what these checks read. Applied 3x for replay safety.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const migDir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readdirSync(migDir).find((f) => f.endsWith("_job_notices_follow_job_switches.sql"));
if (!mig) throw new Error("migration not found");
const OLD = readFileSync(`${migDir}20261030035326_helpr_start_reminders.sql`, "utf8");
const oldSms = OLD.slice(OLD.indexOf("CREATE OR REPLACE FUNCTION public.sms_kind_for"), OLD.indexOf("REVOKE ALL ON FUNCTION public.sms_kind_for"));

const U = "11111111-1111-1111-1111-111111111111";
const JOB = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null, read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
CREATE TABLE public.notification_type_pref_map (type text primary key, pref_column text);
INSERT INTO notification_type_pref_map VALUES ('warning','system_alerts'),('job_updates','job_updates'),('info','work_status'),('new_offers','new_offers');
CREATE TABLE public.dedupe_seen (type text);
CREATE FUNCTION public.dup_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.dedupe_seen VALUES (NEW.type); RETURN NEW; END $$;
CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.dup_probe();
${oldSms}
`);

const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: the migration is NOT applied");
else {
  const sql = readFileSync(`${migDir}${mig}`, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => Object.values((await q(s, p))[0] ?? {})[0];
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };
const insert = async (title, type = "warning", link = null) =>
  (await q(`insert into notifications(user_id,title,message,type,link,job_id) values ($1,$2,'m',$3,$4,$5) returning type, title, job_id`, [U, title, type, link, JOB]))[0];
const pref = async (t) => one(`select pref_column from notification_type_pref_map where type=$1`, [t]);
const kindOfRow = async (r) => one(`select sms_kind_for($1,$2,$3::uuid)`, [r.type, r.title, r.job_id]);

// Each title the senders on prod write as 'warning', and the text it must keep: the move changes no text.
const MOVED = [
  ["Your Helpr cancelled", "job_cancelled"],
  ["A dispute was opened", "dispute"],
  ["Job disputed", "dispute"],
  ["Offer declined", null],
  ["Offer expired", null],
  ["Your Helpr didn't confirm", null],
  ["Your Helpr hasn't confirmed yet", null],
  ["A Helpr on your crew hasn't confirmed yet", null],
];
for (const [title, kind] of MOVED) {
  const r = await insert(title);
  check(`"${title}" follows Job updates`, r.type === "job_updates" && (await pref(r.type)) === "job_updates", r.type);
  const got = await kindOfRow(r);
  check(`"${title}" texts as before (${kind})`, got === kind, String(got));
}

// Left alone: not job notices, or matched on 'warning' as always-on reminders (job_reminder_types).
for (const title of ["Warning — keep it on Helpr", "Job cancelled", "Job reposted", "Your payout didn't go through", "Payment failed"]) {
  const r = await insert(title);
  check(`"${title}" stays warning`, r.type === "warning", r.type);
}
check("a money warning still texts money_problem", (await one(`select sms_kind_for('warning','Payment failed',$1::uuid)`, [JOB])) === "money_problem");
check("Job cancelled still texts job_cancelled", (await one(`select sms_kind_for('warning','Job cancelled',$1::uuid)`, [JOB])) === "job_cancelled");

const decl = await insert("Offer declined", "warning", "/declutter?tab=selling");
check("a Declutter link is left to declutter_notice_type", decl.type === "warning", decl.type);
const other = await insert("Offer declined", "new_offers");
check("the trigger only reads warning rows", other.type === "new_offers", other.type);

// The dedupe trigger reads the type, so it must see the new one ('aa_' fires first).
await db.exec(`truncate dedupe_seen`);
await insert("Your Helpr cancelled");
check("the duplicate check sees the new type", (await one(`select type from dedupe_seen`)) === "job_updates", await one(`select type from dedupe_seen`));

// The hire offer moves in the template to new_offers, the switch the direct offer follows.
check("hire offer under new_offers still texts job_offer", (await one(`select sms_kind_for('new_offers','New job offer',$1::uuid)`, [JOB])) === "job_offer");
check("a hire offer written before the deploy (info) still texts job_offer", (await one(`select sms_kind_for('info','📋 New job offer!',$1::uuid)`, [JOB])) === "job_offer");
check("direct offer unchanged", (await one(`select sms_kind_for('new_offers','You got a direct job offer!',$1::uuid)`, [JOB])) === "job_offer");

// Other job updates keep the catch-all, nearby jobs stay never-texted.
check("an ordinary job update still texts job_update", (await one(`select sms_kind_for('job_updates','Your job expires soon',$1::uuid)`, [JOB])) === "job_update");
check("job_match is never texted", (await one(`select sms_kind_for('job_match','New job posted',$1::uuid)`, [JOB])) === null);

if (!skip) {
  const acl = await one(`select proacl::text from pg_proc where proname='sms_kind_for'`);
  check("sms_kind_for grants as prod (service_role, no PUBLIC)", /service_role=X/.test(acl) && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl), acl);
  const tacl = await one(`select proacl::text from pg_proc where proname='notifications_job_notice_type'`);
  check("the trigger function is not callable by members", !/(^|[{,])=X/.test(tacl) && !/anon=X/.test(tacl) && !/authenticated=X/.test(tacl), tacl);
  check("the trigger function is not a definer", (await one(`select prosecdef from pg_proc where proname='notifications_job_notice_type'`)) === false);
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL PASS (${results.length})`);
process.exit(failed ? 1 : 0);
