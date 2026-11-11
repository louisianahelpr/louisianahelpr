#!/usr/bin/env node
/**
 * PGlite proof for 20261111195445_withdrawn_application_tells_the_poster.sql (F297): when a Helpr withdraws (deletes
 * their own pending application), the poster is told, with the right next step, and the stale "applied" notice is
 * marked read. Nobody is told when the row is deleted by anyone else, when it was not pending, when the job is no
 * longer open, or across a block.
 *
 *   node src/test/pglite/withdrawnApplicationTellsThePoster.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/withdrawnApplicationTellsThePoster.pglite.mjs  # RED: nothing happens
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIG = "20261111195445_withdrawn_application_tells_the_poster.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
readdirSync(dir);

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // Helpr who withdraws
const H2 = "33333333-3333-3333-3333-333333333333"; // another applicant
const B = "44444444-4444-4444-4444-444444444444"; // blocked applicant
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.application_status AS ENUM ('pending','accepted','declined','withdrawn');
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (id uuid primary key, title text, customer_id uuid, status public.job_status default 'open');
CREATE TABLE public.applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status public.application_status default 'pending');
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null,
  type text, link text, job_id uuid, read boolean not null default false, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)) $$;
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
INSERT INTO profiles VALUES ('${P}','Pat Poster'),('${H}','Yusef Bell'),('${H2}','Dana Dupre'),('${B}','Bo Blocked');
INSERT INTO user_blocks VALUES ('${P}', '${B}');
`);
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
let n = 0;
const job = async (title, status = "open") => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query(`INSERT INTO jobs VALUES ($1, $2, $3, $4)`, [id, title, P, status]);
  return id;
};
const apply = async (j, h, status = "pending") => (await db.query(
  `INSERT INTO applications (job_id, helper_id, status) VALUES ($1, $2, $3) RETURNING id`, [j, h, status])).rows[0].id;
const appliedNotice = (j, name) => db.query(`INSERT INTO notifications (user_id, title, message, type, link) VALUES ($1, 'New application', $2, 'application', $3)`,
  [P, `${name} applied to "x". Next: review and pick a Helpr.`, `/posts?job=${j}`]);
const as = async (uid, sql, params) => { await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`); return db.query(sql, params); };
const withdrawn = async (j) => (await db.query(`SELECT title, message, type, link, job_id FROM notifications WHERE user_id = $1 AND title = 'Application withdrawn' AND link = $2`, [P, `/posts?job=${j}`])).rows;

// 1. Last applicant withdraws: told, job still open.
const j1 = await job("Paint a fence");
await appliedNotice(j1, "Yusef B.");
await appliedNotice(j1, "Dana D.");
const a1 = await apply(j1, H);
await as(H, `DELETE FROM applications WHERE id = $1`, [a1]);
let w = await withdrawn(j1);
check("withdraw tells the poster", w.length === 1 && w[0].message === 'Yusef B. withdrew from "Paint a fence". Your job is still open for new applicants.', w);
check("withdraw notice is an application notice on the job", w[0]?.type === "application" && w[0]?.job_id === j1, w);
const reads = (await db.query(`SELECT message, read FROM notifications WHERE user_id = $1 AND title = 'New application' AND link = $2 ORDER BY message`, [P, `/posts?job=${j1}`])).rows;
check("the withdrawn Helpr's applied notice is marked read; the other applicant's is not",
  reads.length === 2 && reads.find((r) => r.message.startsWith("Yusef B."))?.read === true && reads.find((r) => r.message.startsWith("Dana D."))?.read === false, reads);

// 2. Others still waiting: next step is to review them.
const j2 = await job("Mow two lawns");
const a2 = await apply(j2, H);
await apply(j2, H2);
await as(H, `DELETE FROM applications WHERE id = $1`, [a2]);
w = await withdrawn(j2);
check("with others waiting: 'Next: review the other applicants.'", w[0]?.message === 'Yusef B. withdrew from "Mow two lawns". Next: review the other applicants.', w);

// 3. Not a withdraw: deleted by the server (no session) or by someone else.
const j3 = await job("Rake leaves");
const a3 = await apply(j3, H);
await as(null, `DELETE FROM applications WHERE id = $1`, [a3]);
check("a server-side delete tells nobody", (await withdrawn(j3)).length === 0, await withdrawn(j3));
const a3b = await apply(j3, H);
await as(P, `DELETE FROM applications WHERE id = $1`, [a3b]);
check("a delete by someone other than the applicant tells nobody", (await withdrawn(j3)).length === 0, await withdrawn(j3));

// 4. Not pending, job not open, blocked.
const j4 = await job("Haul boxes");
const a4 = await apply(j4, H, "declined");
await as(H, `DELETE FROM applications WHERE id = $1`, [a4]);
check("a non-pending row tells nobody", (await withdrawn(j4)).length === 0, await withdrawn(j4));
const j5 = await job("Wash a car", "accepted");
const a5 = await apply(j5, H);
await as(H, `DELETE FROM applications WHERE id = $1`, [a5]);
check("a job no longer open tells nobody", (await withdrawn(j5)).length === 0, await withdrawn(j5));
const j6 = await job("Fix a gate");
const a6 = await apply(j6, B);
await as(B, `DELETE FROM applications WHERE id = $1`, [a6]);
check("no notice across a block", (await withdrawn(j6)).length === 0, await withdrawn(j6));

await as(null, `SELECT 1`);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'notify_poster_on_application_withdrawn'`)).rows[0]?.a ?? "";
check("the trigger function exists and anon/authenticated cannot execute it", acl !== "" && !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), acl);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
