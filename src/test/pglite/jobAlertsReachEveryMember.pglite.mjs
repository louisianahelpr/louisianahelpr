#!/usr/bin/env node
/**
 * Every new job reaches every member (owner, 2026-10-09: "just send emails when
 * any job is posted no matter what parish"). Runs the migration
 * 20261009171601_job_alerts_reach_every_member.sql VERBATIM (3x) over the live
 * helpers it calls (job_announceable_to, early_access_visible_at, taken from
 * the newest migrations), funds a job, sweeps the queue through
 * deliver_parish_match_alert, and checks who got a notification + an email call.
 *
 *   node src/test/pglite/jobAlertsReachEveryMember.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobAlertsReachEveryMember.pglite.mjs   # RED: the previous fan-out
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261009171601_job_alerts_reach_every_member.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS fan-out (expect FAILs)");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in migrations sorting before `before`. */
function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "44444444-0000-0000-0000-000000000000";
const M = {
  newSameParish: "44444444-0000-0000-0000-000000000001", // joined today, never applied (Treasure, Audrey)
  newOtherParish: "44444444-0000-0000-0000-000000000002", // Acadia member, Vermilion job (Destiny, Jante)
  veteran: "44444444-0000-0000-0000-000000000003", // same parish, has applied (reached before too)
  optedOut: "44444444-0000-0000-0000-000000000004", // turned Job Matches off
  unverified: "44444444-0000-0000-0000-000000000005", // never confirmed the email
  banned: "44444444-0000-0000-0000-000000000006",
  blocked: "44444444-0000-0000-0000-000000000007", // the poster blocked them
  testAccount: "44444444-0000-0000-0000-000000000008", // an is_seed test account
};
const PARISH = { newSameParish: "Vermilion", newOtherParish: "Acadia", veteran: "Vermilion", optedOut: "Iberia", unverified: "Vermilion", banned: "Vermilion", blocked: "Vermilion", testAccount: "Vermilion" };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.early_access_delay_minutes(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.applications (helper_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  parent_job_id uuid, offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, customer_id uuid, helper_id uuid,
  category text, parish text, title text, credential_tier integer NOT NULL DEFAULT 0);
CREATE TABLE public.job_match_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, source text, notify_at timestamptz,
  title text, message text, link text, send_email boolean, status text, drop_reason text, settled_at timestamptz, attempts integer DEFAULT 0,
  retry_after timestamptz, UNIQUE (user_id, job_id));
CREATE TABLE public.parish_match_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, notify_at timestamptz, UNIQUE (user_id, job_id));
`);
await db.exec(definitionBefore("early_access_visible_at", NEW_FILE));
await db.exec(definitionBefore("job_announceable_to", NEW_FILE));
await db.exec(definitionBefore("deliver_parish_match_alert", NEW_FILE));
await db.exec(definitionBefore("notify_helpers_on_job_post", NEW_FILE));
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_helpers_on_job_post();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Vermilion')`, [POSTER]);
for (const [k, id] of Object.entries(M)) {
  await q(`INSERT INTO public.profiles VALUES ($1, $2, $3, $4)`, [id, k !== "unverified", k === "banned" ? "banned" : "active", PARISH[k]]);
  await q(`INSERT INTO public.notification_preferences VALUES ($1, $2, false)`, [id, k !== "optedOut"]);
}
await q(`INSERT INTO public.applications VALUES ($1)`, [M.veteran]);
await q(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [M.testAccount]);
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [POSTER, M.blocked]);

// The owner's real case: a funded Vermilion job.
const [{ id: JOB }] = await q(
  `INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, title) VALUES ('open','escrow',$1,'yard_work','Vermilion','Mow & Weed Eat Yard') RETURNING id`,
  [POSTER],
);
// The sweep's work, row by row.
for (const r of await q(`SELECT user_id, job_id FROM public.parish_match_alert_queue`)) {
  await q(`SELECT public.deliver_parish_match_alert($1, $2)`, [r.user_id, r.job_id]);
}
const got = async (id) => (await q(`SELECT title, message FROM public.notifications WHERE user_id = $1 AND job_id = $2 AND type = 'job_match'`, [id, JOB]));
const emailed = async (id) => (await q(`SELECT 1 FROM net.calls WHERE body->>'user_id' = $1 AND body->>'type' = 'job_match'`, [id])).length;

for (const k of ["newSameParish", "newOtherParish", "veteran"]) {
  const n = await got(M[k]);
  check(`${k}: one in-app alert and one email`, n.length === 1 && (await emailed(M[k])) === 1, JSON.stringify(n));
}
if (!RED) {
  const [n] = await got(M.newOtherParish);
  check("worded for any parish: 'New job posted', naming the job's parish", n?.title === "New job posted"
    && n?.message === 'A new yard_work job was just posted in Vermilion Parish: "Mow & Weed Eat Yard"', JSON.stringify(n));
}
for (const k of ["optedOut", "unverified", "banned", "blocked", ...(RED ? [] : ["testAccount"])]) {
  check(`${k}: nothing`, (await got(M[k])).length === 0 && (await emailed(M[k])) === 0);
}
check("the poster is not told about their own job", (await got(POSTER)).length === 0 && (await emailed(POSTER)) === 0);

// Once per (job, member): the job re-enters open and the sweep runs again.
await q(`UPDATE public.jobs SET status = 'open' WHERE id = $1`, [JOB]);
await db.exec(`INSERT INTO public.jobs (id, status, payment_status, customer_id, parish, title) SELECT gen_random_uuid(), 'cancelled', 'refunded', customer_id, parish, title FROM public.jobs WHERE false`);
for (const r of await q(`SELECT user_id, job_id FROM public.parish_match_alert_queue`)) {
  await q(`SELECT public.deliver_parish_match_alert($1, $2)`, [r.user_id, r.job_id]);
}
check("a second sweep sends nothing twice", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === (RED ? 1 : 3));

// A job with no parish is still announced (the old trigger returned early).
const [{ id: NOPARISH }] = await q(
  `INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, title) VALUES ('open','escrow',$1,'errands',NULL,'Grocery run') RETURNING id`,
  [POSTER],
);
for (const r of await q(`SELECT user_id, job_id FROM public.parish_match_alert_queue WHERE job_id = $1`, [NOPARISH])) {
  await q(`SELECT public.deliver_parish_match_alert($1, $2)`, [r.user_id, r.job_id]);
}
const np = await q(`SELECT message FROM public.notifications WHERE user_id = $1 AND job_id = $2`, [M.newSameParish, NOPARISH]);
check("a job with no parish reaches members too, worded without one", np.length === 1 && np[0].message === 'A new errands job was just posted: "Grocery run"', JSON.stringify(np));

// Grants: server-only, as before.
const g = (await q(`SELECT has_function_privilege('anon','public.deliver_parish_match_alert(uuid,uuid)','EXECUTE') a,
                           has_function_privilege('authenticated','public.deliver_parish_match_alert(uuid,uuid)','EXECUTE') u`))[0];
if (!RED) check("deliver_parish_match_alert stays server-only", !g.a && !g.u, JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
