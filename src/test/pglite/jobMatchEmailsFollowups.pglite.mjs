#!/usr/bin/env node
/**
 * Q1585: the four follow-ups to "every new job reaches every member" (owner
 * decisions, 2026-10-12). Runs 20261012042612_job_match_emails_followups.sql
 * VERBATIM (3x) over the definitions it replaces (taken from the migrations
 * before it) and the live helpers they call, then drives the real path:
 * fund a job -> notify_helpers_on_job_post queues -> the every-minute sweep
 * (sweep_saved_search_alert_queue) -> deliver_parish_match_alert; the instant
 * path's deliver_job_match; and the daily in-app list, sweep_daily_job_digest.
 *
 *   node src/test/pglite/jobMatchEmailsFollowups.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobMatchEmailsFollowups.pglite.mjs   # RED: the previous definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261012042612_job_match_emails_followups.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

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

const POSTER = "55555555-0000-0000-0000-000000000000";
const M = {
  plain: "55555555-0000-0000-0000-000000000001", // an ordinary member
  digest: "55555555-0000-0000-0000-000000000002", // had "Daily Match Digest" on
  busy: "55555555-0000-0000-0000-000000000003", // 10 job alerts in the last hour
  optedOut: "55555555-0000-0000-0000-000000000004", // Job Matches off
  veteran: "55555555-0000-0000-0000-000000000005", // has applied: the daily list's audience
  instantDigest: "55555555-0000-0000-0000-000000000006", // instant path, had digest on
  busyInstant: "55555555-0000-0000-0000-000000000007", // a queued parish ledger row over the cap
};

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
CREATE TABLE public.cron_defects (fn text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (a, b, c) $$;
CREATE TABLE public.error_logs (severity text, message text, tags jsonb);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.applications (helper_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid,
  read boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  parent_job_id uuid, offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, customer_id uuid, helper_id uuid,
  category text, parish text, title text, budget numeric DEFAULT 50, is_urgent boolean DEFAULT false, credential_tier integer NOT NULL DEFAULT 0);
CREATE TABLE public.job_match_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, source text, notify_at timestamptz,
  title text, message text, link text, send_email boolean, status text DEFAULT 'queued', drop_reason text, settled_at timestamptz, attempts integer DEFAULT 0,
  retry_after timestamptz, UNIQUE (user_id, job_id));
CREATE TABLE public.parish_match_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, notify_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, retry_after timestamptz, UNIQUE (user_id, job_id));
CREATE TABLE public.saved_search_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, notify_at timestamptz,
  search_name text, matched_search_ids uuid[]);
CREATE TABLE public.match_digest_queue (user_id uuid, job_id uuid, UNIQUE (user_id, job_id));
`);
for (const fn of ["early_access_visible_at", "job_announceable_to", "deliver_parish_match_alert", "notify_helpers_on_job_post",
  "deliver_job_match", "sweep_daily_job_digest", "sweep_saved_search_alert_queue"]) {
  await db.exec(definitionBefore(fn, NEW_FILE));
}
const q = async (s, p = []) => (await db.query(s, p)).rows;

await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Vermilion')`, [POSTER]);
for (const [k, id] of Object.entries(M)) {
  await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Vermilion')`, [id]);
  await q(`INSERT INTO public.notification_preferences (user_id, job_matches, match_digest_mode) VALUES ($1, $2, $3)`,
    [id, k !== "optedOut", k === "digest" || k === "instantDigest"]);
}
await q(`INSERT INTO public.applications VALUES ($1)`, [M.veteran]);
// Fill the hourly cap: one alert every 5 minutes, the oldest 50 minutes ago.
for (const id of [M.busy, M.busyInstant]) {
  for (let i = 0; i < 10; i++) {
    await q(`INSERT INTO public.notifications (user_id, title, type, created_at) VALUES ($1, 'earlier', 'job_match', now() - make_interval(mins => $2))`, [id, 50 - i * 5]);
  }
}

if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
  // (b) the existing digest rows were turned off; the readers must not need
  // that: put the flag back on underneath the guard trigger and send anyway.
  check("(b) the migration turned every digest flag off",
    (await q(`SELECT count(*)::int n FROM public.notification_preferences WHERE match_digest_mode`))[0].n === 0);
  await db.exec(`ALTER TABLE public.notification_preferences DISABLE TRIGGER trg_hold_match_digest_mode_off;
    UPDATE public.notification_preferences SET match_digest_mode = true WHERE user_id IN ('${M.digest}', '${M.instantDigest}');
    ALTER TABLE public.notification_preferences ENABLE TRIGGER trg_hold_match_digest_mode_off;`);
}
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_helpers_on_job_post();`);

const fund = async (title) => (await q(
  `INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, title) VALUES ('open','escrow',$1,'yard_work','Vermilion',$2) RETURNING id`,
  [POSTER, title],
))[0].id;
const sweep = () => q(`SELECT public.sweep_saved_search_alert_queue()`);
const alerts = async (id, job) => (await q(`SELECT 1 FROM public.notifications WHERE user_id = $1 AND job_id = $2 AND type = 'job_match'`, [id, job])).length;
const emails = async (id, job) => (await q(`SELECT 1 FROM net.calls WHERE body->>'user_id' = $1 AND body->>'job_id' = $2`, [id, job])).length;

const JOB = await fund("Mow & Weed Eat Yard");

// (c) the set-based insert queues exactly the eligible members.
const queued = (await q(`SELECT user_id::text FROM public.parish_match_alert_queue WHERE job_id = $1 ORDER BY 1`, [JOB])).map((r) => r.user_id);
check("(c) queues the plain member and the veteran", queued.includes(M.plain) && queued.includes(M.veteran), queued.join(","));
check("(c) never the opted-out member or the poster", !queued.includes(M.optedOut) && !queued.includes(POSTER));
// (a) at queue time the cap no longer filters a member out.
check("(a) a member over the hourly cap is still queued", queued.includes(M.busy), queued.join(","));
// (b) a digest member is queued like everyone else.
check("(b) a member who had digest on is queued", queued.includes(M.digest));

await sweep();
check("plain member: one alert and one email", (await alerts(M.plain, JOB)) === 1 && (await emails(M.plain, JOB)) === 1);
check("(b) member who had digest on: one alert and one email", (await alerts(M.digest, JOB)) === 1 && (await emails(M.digest, JOB)) === 1);
check("opted-out member: nothing", (await alerts(M.optedOut, JOB)) === 0 && (await emails(M.optedOut, JOB)) === 0);

// (a) over the cap: not sent now, and NOT dropped: still queued, due when a slot opens.
check("(a) over the cap: nothing sent this hour", (await alerts(M.busy, JOB)) === 0);
const [held] = await q(`SELECT retry_after, retry_after - now() AS wait FROM public.parish_match_alert_queue WHERE user_id = $1 AND job_id = $2`, [M.busy, JOB]);
check("(a) over the cap: the alert is still queued", !!held, JSON.stringify(held ?? null));
if (held) {
  const [{ ok }] = await q(`SELECT $1::timestamptz BETWEEN now() + interval '9 minutes' AND now() + interval '11 minutes' AS ok`, [held.retry_after]);
  check("(a) re-queued for when the oldest alert ages out (about 10 minutes)", ok, String(held.wait));
}
check("(a) nothing recorded as sent or dropped for it", (await q(`SELECT 1 FROM public.job_match_queue WHERE user_id = $1 AND job_id = $2`, [M.busy, JOB])).length === 0);
// Time passes: the last hour's alerts age out and the row comes due.
await q(`UPDATE public.notifications SET created_at = created_at - interval '2 hours' WHERE user_id = $1 AND job_id IS NULL`, [M.busy]);
await q(`UPDATE public.parish_match_alert_queue SET retry_after = now() - interval '1 second' WHERE user_id = $1`, [M.busy]);
await sweep();
check("(a) once a slot opens the held alert is sent, once", (await alerts(M.busy, JOB)) === 1 && (await emails(M.busy, JOB)) === 1);
check("(a) and it leaves the queue", (await q(`SELECT 1 FROM public.parish_match_alert_queue WHERE user_id = $1`, [M.busy])).length === 0);

// (a) the instant ledger's parish row over the cap waits too (was: dropped).
const [{ id: LROW }] = await q(
  `INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link, send_email, status)
   VALUES ($1, $2, 'parish', now(), 't', 'm', '/home', true, 'queued') RETURNING id`, [M.busyInstant, JOB]);
await q(`DELETE FROM public.parish_match_alert_queue WHERE user_id = $1`, [M.busyInstant]);
await q(`SELECT public.deliver_job_match($1)`, [LROW]);
const [lrow] = await q(`SELECT status, drop_reason, retry_after > now() AS later FROM public.job_match_queue WHERE id = $1`, [LROW]);
check("(a) deliver_job_match: a parish row over the cap stays queued for later", lrow.status === "queued" && lrow.later === true, JSON.stringify(lrow));

// (b) the instant path sends to a member who had digest on (was: batched to a list nobody can see).
const JOB2 = await fund("Pressure wash driveway");
await q(`DELETE FROM public.parish_match_alert_queue WHERE user_id = $1`, [M.instantDigest]);
const [{ id: IROW }] = await q(
  `INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link, send_email, status)
   VALUES ($1, $2, 'instant', now(), 'Near you', 'A job near you', '/home', true, 'queued') RETURNING id`, [M.instantDigest, JOB2]);
await q(`SELECT public.deliver_job_match($1)`, [IROW]);
const [irow] = await q(`SELECT status FROM public.job_match_queue WHERE id = $1`, [IROW]);
check("(b) deliver_job_match: an instant match to a former digest member is sent", irow.status === "sent", JSON.stringify(irow));
check("(b) and nothing goes to the digest queue", (await q(`SELECT 1 FROM public.match_digest_queue`)).length === 0);

// The daily in-app list never repeats a job a member was already told about.
await sweep();
await q(`SELECT public.sweep_daily_job_digest()`);
const digestRows = async (id) => q(`SELECT message FROM public.notifications WHERE user_id = $1 AND title LIKE 'New jobs in%'`, [id]);
check("daily list: nothing for a member already alerted about every new job", (await digestRows(M.veteran)).length === 0,
  JSON.stringify(await digestRows(M.veteran)));
// A job no per-job alert covered (the fan-out was off when it was funded) is still listed.
await db.exec(`ALTER TABLE public.jobs DISABLE TRIGGER t`);
const JOB3 = await fund("Haul brush");
await db.exec(`ALTER TABLE public.jobs ENABLE TRIGGER t`);
await q(`UPDATE public.notifications SET created_at = now() - interval '1 day' WHERE title LIKE 'New jobs in%'`);
await q(`SELECT public.sweep_daily_job_digest()`);
const listed = await digestRows(M.veteran);
check("daily list: an uncovered job is still listed, counted once", listed.length === 1 && /^1 new job /.test(listed[0].message), JSON.stringify(listed));
void JOB3;

// (b) the switch is gone; nothing can turn digest mode back on.
if (!RED) {
  await q(`UPDATE public.notification_preferences SET match_digest_mode = true WHERE user_id = $1`, [M.plain]);
  await q(`INSERT INTO public.notification_preferences (user_id, job_matches, match_digest_mode) VALUES ($1, true, true)`, [POSTER]);
  const on = (await q(`SELECT count(*)::int n FROM public.notification_preferences WHERE match_digest_mode AND user_id IN ($1, $2)`, [M.plain, POSTER]))[0].n;
  check("(b) an older build writing match_digest_mode = true is held to false", on === 0, `${on} rows on`);
  const g = (await q(`SELECT has_function_privilege('anon','public.hold_match_digest_mode_off()','EXECUTE') a,
                             has_function_privilege('authenticated','public.hold_match_digest_mode_off()','EXECUTE') u,
                             has_function_privilege('anon','public.deliver_parish_match_alert(uuid,uuid)','EXECUTE') d`))[0];
  check("new and restated functions stay server-only", !g.a && !g.u && !g.d, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
