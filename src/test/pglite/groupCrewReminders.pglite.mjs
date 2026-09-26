#!/usr/bin/env node
/**
 * PGlite proof for 20260925235506_group_crew_reminders_and_counts (docs/OPEN.md
 * Q408; owner rules Q407: a crew has no lead, every hired member is equal).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe npx tsx src/test/pglite/groupCrewReminders.pglite.mjs [--replay]
 *   (or node --experimental-strip-types with a resolver for extensionless .ts imports)
 *
 * Every function is read from its EFFECTIVE definition in the migrations before
 * this one (src/test/helpers/effectiveFunctionDefs.ts), never a pinned file;
 * the crew's NULL helper_id is held by the REAL trg_group_job_has_no_lead and
 * every status write runs the real transition matrix. Stubs (not under test):
 * log_cron_defect, identity_is_verified, get_top_helpers_by_parish.
 *
 * RED-BEFORE (this migration NOT applied): on a booked crew of three
 *   R1  nobody on the crew gets "Still on for tomorrow?";
 *   R2  nobody on the crew gets "Starting soon";
 *   R3  nobody gets a no-show check, the poster included;
 *   R4  a fully confirmed crew past its start never auto-starts;
 *   R5  a Helpr's completed crew jobs count nowhere: completed counts, parish
 *       badge, public profile.
 * AFTER: A1..A9 below.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20260925235506_group_crew_reminders_and_counts.sql";
const read = (f) => readFileSync(DIR + f, "utf8");
const MIGRATION = process.env.NEW_MIGRATION_FILE ? readFileSync(process.env.NEW_MIGRATION_FILE, "utf8") : read(THIS);
const REPLAY = process.argv.includes("--replay");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = read(f);
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
const FNS = [
  "is_server_context", "has_role", "enforce_group_job_has_no_lead", "enforce_job_status_transition",
  "sweep_dayof_confirm_reminders", "sweep_job_start_reminders", "sweep_no_show_alerts", "auto_start_due_jobs",
  "get_helper_completed_counts", "get_helper_parish_badges", "get_public_profile_stats",
];
const TRIGGERS = ["trg_group_job_has_no_lead", "trg_enforce_job_status_transition"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), M1 = U(2), M2 = U(3), M3 = U(4), SOLO = U(5);
const CREW = U(101), SINGLE = U(102), DONE1 = U(103), DONE2 = U(104), DONE_SINGLE = U(105);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, parish text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  payment_status text DEFAULT 'escrow', stripe_session_id text,
  date_needed date, start_time time, is_flexible_schedule boolean DEFAULT false,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, poster_confirmed_at timestamptz,
  dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz,
  start_reminder_sent_at timestamptz, no_show_alert_sent_at timestamptz,
  helper_arrived_at timestamptz, revision_count integer, updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_arrived_at timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, read boolean DEFAULT false, job_id uuid);
CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, parish text, stripe_identity_verified boolean,
  idv_status text, stripe_account_id text, background_check_status text, email_verified boolean DEFAULT true, ban_status text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int,
  status text DEFAULT 'published', feedback_visible_at timestamptz);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text);
CREATE TABLE public.cron_defects (fn text, key text, err text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Stubs (not under test).
CREATE FUNCTION public.log_cron_defect(p_fn text, p_key text, p_err text, p_ctx jsonb) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.cron_defects VALUES (p_fn, p_key, p_err) $$;
CREATE FUNCTION public.identity_is_verified(text, boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce($2, false) $$;
CREATE FUNCTION public.get_top_helpers_by_parish(text, int) RETURNS TABLE(user_id uuid) LANGUAGE sql AS $$ SELECT NULL::uuid WHERE false $$;

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const at = (offset) =>
  `(now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::date, (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::time`;

/**
 * A booked crew of three and a single booking, both starting at `offset`.
 * `crew` sets each member's roster stamps.
 */
async function seed(offset, { status = "accepted", crew = {}, single = true } = {}) {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.cron_defects; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 'open', true, 3, ${at(offset)});
    ${single ? `INSERT INTO public.jobs (id, customer_id, helper_id, title, status, date_needed, start_time, helper_confirmed_at)
      VALUES ('${SINGLE}', '${POSTER}', '${SOLO}', 'Mow a lawn', 'accepted', ${at(offset)}, now() - interval '3 days');` : ""}
    ${[M1, M2, M3].map((m, i) => {
      const c = crew[m] ?? {};
      return `INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at, helper_dayof_confirmed_at, helper_arrived_at)
        VALUES ('${CREW}', '${m}', ${i}, 3333, ${c.confirmed ?? "now() - interval '3 days'"}, ${c.dayof ?? "NULL"}, ${c.arrived ?? "NULL"});`;
    }).join("\n")}
    ${status !== "open" ? `UPDATE public.jobs SET status = 'accepted' WHERE id = '${CREW}';` : ""}
    ${status === "in_progress" ? `UPDATE public.jobs SET status = 'in_progress' WHERE id = '${CREW}';` : ""}
  `);
}
const got = async (uid, title) => (await all(`SELECT 1 FROM public.notifications WHERE user_id = $1 AND title LIKE $2`, [uid, title])).length;
const crewGot = async (title) => ({ m1: await got(M1, title), m2: await got(M2, title), m3: await got(M3, title), poster: await got(POSTER, title) });
const status = async (id = CREW) => (await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [id])).s;

/** Two completed crew jobs and one completed single job for M1, all in St. Tammany. */
async function seedHistory() {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs; DELETE FROM public.profiles;
    INSERT INTO public.profiles (user_id, parish) VALUES ('${M1}', 'St. Tammany'), ('${POSTER}', 'St. Tammany');
    INSERT INTO public.jobs (id, customer_id, title, status, is_group_job, helpers_needed, parish)
      VALUES ('${DONE1}', '${POSTER}', 'Crew 1', 'open', true, 2, 'St. Tammany'), ('${DONE2}', '${POSTER}', 'Crew 2', 'open', true, 2, 'St. Tammany');
    INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${DONE1}', '${M1}'), ('${DONE1}', '${M2}'), ('${DONE2}', '${M1}'), ('${DONE2}', '${M3}');
    UPDATE public.jobs SET status = 'accepted' WHERE id IN ('${DONE1}', '${DONE2}');
    UPDATE public.jobs SET status = 'completed' WHERE id IN ('${DONE1}', '${DONE2}');
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, parish) VALUES ('${DONE_SINGLE}', '${POSTER}', '${M1}', 'Single', 'accepted', 'St. Tammany');
    UPDATE public.jobs SET status = 'completed' WHERE id = '${DONE_SINGLE}';
  `);
}
const counts = async () => {
  const c = (await one(`SELECT completed_jobs::int AS n FROM public.get_helper_completed_counts(ARRAY['${M1}']::uuid[])`))?.n ?? 0;
  const b = await one(`SELECT parish_completed_jobs AS n, is_verified_local AS v FROM public.get_helper_parish_badges('${M1}')`);
  const p = await one(`SELECT completed_jobs_as_helper AS h, jobs_total AS t FROM public.get_public_profile_stats(ARRAY['${M1}']::uuid[])`);
  const pp = await one(`SELECT completed_jobs_as_helper AS h, posted_jobs_total AS posted FROM public.get_public_profile_stats(ARRAY['${POSTER}']::uuid[])`);
  return { counts: c, parish: b?.n, verifiedLocal: b?.v, profile: p?.h, profileTotal: p?.t, posterAsHelper: pp?.h, posterPosted: pp?.posted };
};

await db.exec(SCHEMA);
console.log(`world: ${FNS.length} functions, ${TRIGGERS.length} triggers from their effective definitions before ${THIS}`);

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
await seed("+20 hours");
let lead = "allowed";
try { await db.exec(`UPDATE public.jobs SET helper_id = '${M1}' WHERE id = '${CREW}'`); } catch (e) { lead = String(e.message); }
check("world: the real trg_group_job_has_no_lead holds the crew's helper_id at NULL", /group_job_has_no_lead/.test(lead));
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
const r1 = await crewGot("Still on for tomorrow?");
check("R1 nobody on the crew (nor its poster) gets \"Still on for tomorrow?\" — the single booking beside it does", r1.m1 + r1.m2 + r1.m3 === 0 && (await got(SOLO, "Still on for tomorrow?")) === 1, JSON.stringify(r1));

await seed("+20 minutes");
await db.exec(`SELECT public.sweep_job_start_reminders()`);
const r2 = await crewGot("Starting soon");
check("R2 nobody on the crew gets \"Starting soon\"", r2.m1 + r2.m2 + r2.m3 === 0 && (await got(SOLO, "Starting soon")) === 1, JSON.stringify(r2));

await seed("-1 hour");
await db.exec(`SELECT public.sweep_no_show_alerts()`);
const r3 = await crewGot("%");
check("R3 no no-show check reaches the crew or the poster about the crew", r3.m1 + r3.m2 + r3.m3 === 0 && (await all(`SELECT 1 FROM public.notifications WHERE link LIKE '%${CREW}%'`)).length === 0, JSON.stringify(r3));

await seed("-10 minutes");
await db.exec(`SELECT public.auto_start_due_jobs()`);
check("R4 a fully confirmed crew past its start never auto-starts (the single booking does)", (await status()) === "accepted" && (await status(SINGLE)) === "in_progress", `${await status()} / ${await status(SINGLE)}`);

await seedHistory();
const r5 = await counts();
check("R5 M1's two completed crew jobs count nowhere: completed 1, parish 1, profile 1 (the single job only)", r5.counts === 1 && r5.parish === 1 && r5.profile === 1, JSON.stringify(r5));

// ════════════════════════════════════════════════════════════════════════════
for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
  try {
    await db.exec(MIGRATION);
    console.log(`\napply #${i}: OK`);
  } catch (e) {
    console.log(`\napply #${i}: FAILED — ${e.message ?? e}`);
    failures++;
  }
}
console.log("\n── AFTER (migration applied) ────────────────────────────────────");

await seed("+20 hours", { crew: { [M3]: { dayof: "now() - interval '1 hour'" } } });
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
const a1 = await crewGot("Still on for tomorrow?");
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
const a1again = await crewGot("Still on for tomorrow?");
check(
  "A1 day-of: M1 and M2 are reminded, M3 (already confirmed for the day) is not, the poster once per job; a second run sends nothing more",
  a1.m1 === 1 && a1.m2 === 1 && a1.m3 === 0 && a1.poster === 2 && JSON.stringify(a1again) === JSON.stringify(a1) &&
    (await got(SOLO, "Still on for tomorrow?")) === 1,
  JSON.stringify({ a1, a1again }),
);
await seed("+20 hours", { crew: { [M2]: { confirmed: "now() - interval '2 hours'" } }, single: false });
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
const a1b = await crewGot("Still on for tomorrow?");
check("A2 the grace: a member hired inside the window (2h ago) is not asked again", a1b.m1 === 1 && a1b.m2 === 0 && a1b.m3 === 1, JSON.stringify(a1b));

await seed("+10 hours", { crew: { [M1]: { dayof: "now()" } }, single: false });
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
await db.exec(`SELECT public.sweep_dayof_confirm_reminders()`);
const a3 = await all(`SELECT title FROM public.notifications WHERE user_id = $1 AND type = 'warning'`, [POSTER]);
check("A3 T-12h: the poster is told ONCE that 2 members have not confirmed", a3.length === 1 && a3[0].title === "2 Helprs on your crew haven't confirmed yet", JSON.stringify(a3));

await seed("+20 minutes");
await db.exec(`SELECT public.sweep_job_start_reminders()`);
await db.exec(`SELECT public.sweep_job_start_reminders()`);
const a4 = await crewGot("Starting soon");
check("A4 start reminder: every member once, the poster once for the crew (and once for the single job)", a4.m1 === 1 && a4.m2 === 1 && a4.m3 === 1 && a4.poster === 2 && (await got(SOLO, "Starting soon")) === 1, JSON.stringify(a4));

await seed("-1 hour", { status: "in_progress", crew: { [M1]: { arrived: "now() - interval '50 minutes'" } } });
await db.exec(`SELECT public.sweep_no_show_alerts()`);
await db.exec(`SELECT public.sweep_no_show_alerts()`);
const a5 = { m1: await got(M1, "Did you start this job?"), m2: await got(M2, "Did you start this job?"), m3: await got(M3, "Did you start this job?"), poster: await got(POSTER, "Has your crew arrived?") };
check("A5 no-show on an in-progress crew: M2 and M3 (not arrived) are asked, M1 (arrived) is not, the poster once", a5.m1 === 0 && a5.m2 === 1 && a5.m3 === 1 && a5.poster === 1, JSON.stringify(a5));
await seed("-1 hour", { status: "in_progress", single: false, crew: Object.fromEntries([M1, M2, M3].map((m) => [m, { arrived: "now() - interval '40 minutes'" }])) });
await db.exec(`SELECT public.sweep_no_show_alerts()`);
check("A6 a crew that has all arrived gets no no-show check", (await all(`SELECT 1 FROM public.notifications`)).length === 0);

await seed("-10 minutes");
await db.exec(`SELECT public.auto_start_due_jobs()`);
const a7 = await status();
await seed("-10 minutes", { crew: { [M3]: { confirmed: "NULL" } } });
await db.exec(`SELECT public.auto_start_due_jobs()`);
const a7b = await status();
await seed("-10 minutes", { status: "open" });
await db.exec(`SELECT public.auto_start_due_jobs()`);
const a7c = await status();
check(
  "A7 auto-start: a fully confirmed crew starts at its start time; a crew with an unconfirmed member, or still staffing, does not; the single booking still does",
  a7 === "in_progress" && a7b === "accepted" && a7c === "open" && (await status(SINGLE)) === "in_progress",
  JSON.stringify({ full: a7, unconfirmed: a7b, staffing: a7c }),
);

await seedHistory();
const a8 = await counts();
check(
  "A8 M1's two crew jobs count: completed 3, parish 3 (verified local), profile 3; the poster's own numbers are unchanged (0 as Helpr, 3 posted)",
  a8.counts === 3 && a8.parish === 3 && a8.verifiedLocal === true && a8.profile === 3 && a8.posterAsHelper === 0 && a8.posterPosted === 3,
  JSON.stringify(a8),
);

const grants = await one(`SELECT
  has_function_privilege('anon', 'public.get_helper_completed_counts(uuid[])', 'EXECUTE') AS anon_counts,
  has_function_privilege('authenticated', 'public.get_helper_completed_counts(uuid[])', 'EXECUTE') AS auth_counts,
  has_function_privilege('authenticated', 'public.sweep_dayof_confirm_reminders()', 'EXECUTE') AS auth_sweep,
  has_function_privilege('authenticated', 'public.auto_start_due_jobs()', 'EXECUTE') AS auth_start,
  has_function_privilege('authenticated', 'public.get_helper_parish_badges(uuid)', 'EXECUTE') AS auth_badges`);
check("A9 grants: counts authenticated-only (not anon); sweeps, auto-start and badges not client-callable",
  !grants.anon_counts && grants.auth_counts && !grants.auth_sweep && !grants.auth_start && !grants.auth_badges, JSON.stringify(grants));
const defects = await all(`SELECT * FROM public.cron_defects`);
check("A10 no cron defect was logged by any run", defects.length === 0, JSON.stringify(defects));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
