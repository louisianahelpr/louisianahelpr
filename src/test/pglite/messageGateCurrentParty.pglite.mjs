#!/usr/bin/env node
/**
 * PGlite proof for 20260925175953_message_gate_poster_first_requires_current_party
 * (docs/OPEN.md Q410): can_message_in_job branch 4 ("the poster messaged THIS
 * sender first") now also needs a live (pending/accepted) application, so a
 * removed crew member and a rejected applicant stop being able to post, while
 * every current party and the post-completion 24h window are unchanged.
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/messageGateCurrentParty.pglite.mjs
 *
 * BEFORE is the previous gate text, cut from the newest migration that
 * defined it before this one (found by scanning, not by name): the hole is
 * shown open there. AFTER applies the new migration 3x. The helpers the gate
 * reads (job_messaging_closes_at, job_legacy_completed_at) are cut from their
 * own newest definitions the same way. Tables carry only the columns read.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const Q410 = "20260925175953_message_gate_poster_first_requires_current_party.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(DIR + f, "utf8");

/** Newest `CREATE OR REPLACE FUNCTION public.<name>(` statement before `before`, any dollar tag. */
function newestDef(name, before) {
  let found = null;
  for (const f of FILES) {
    if (before && f >= before) break;
    const sql = read(f).replace(/^\s*--.*$/gm, (m) => " ".repeat(m.length));
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(re)) {
      const rest = sql.slice(m.index);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(open[1], open.index + open[0].length);
      found = { file: f, stmt: `${rest.slice(0, end + open[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name} before ${before}`);
  return found;
}

const OLD_GATE = newestDef("can_message_in_job", Q410);
const CLOSES = newestDef("job_messaging_closes_at", Q410);
const LEGACY = newestDef("job_legacy_completed_at", Q410);
console.log(`previous gate: ${OLD_GATE.file}; closes_at: ${CLOSES.file}; legacy: ${LEGACY.file}`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), PENDING = U(2), REJECTED = U(3), UNMESSAGED = U(4), HIRED = U(5), OFFERED = U(6);
const CREW = U(7), REMOVED = U(8), STRANGER = U(9), ACCEPTED_MSG = U(10);
const JOB = U(101), GROUP = U(102), DONE_1H = U(103), DONE_25H = U(104), CANCELLED = U(105);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TYPE public.application_status AS ENUM ('pending','accepted','rejected');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false,
  completed_at timestamptz, poster_completed_at timestamptz, helper_completed_at timestamptz,
  revision_completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id),
  sender_id uuid NOT NULL, receiver_id uuid, content text, created_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
  helper_id uuid NOT NULL, status public.application_status NOT NULL DEFAULT 'pending');
${LEGACY.stmt}
${CLOSES.stmt}
`;

// Single job: PENDING (messaged), REJECTED (messaged, then rejected),
// UNMESSAGED (pending, never messaged), ACCEPTED_MSG (accepted, messaged),
// OFFERED on the job. HIRED is the helper of the completed jobs.
// GROUP: helper_id NULL (no lead, 20260925154606); CREW on the roster;
// REMOVED was on it, messaged by the poster, row deleted, application rejected.
const DATA = `
INSERT INTO public.jobs (id, customer_id, offered_to_helper_id, status) VALUES ('${JOB}', '${POSTER}', '${OFFERED}', 'open');
INSERT INTO public.jobs (id, customer_id, helper_id, status, is_group_job) VALUES ('${GROUP}', '${POSTER}', NULL, 'accepted', true);
INSERT INTO public.jobs (id, customer_id, helper_id, status, completed_at) VALUES
  ('${DONE_1H}',  '${POSTER}', '${HIRED}', 'completed', now() - interval '1 hour'),
  ('${DONE_25H}', '${POSTER}', '${HIRED}', 'completed', now() - interval '25 hours');
INSERT INTO public.jobs (id, customer_id, helper_id, status, cancelled_at) VALUES
  ('${CANCELLED}', '${POSTER}', '${HIRED}', 'cancelled', now() - interval '1 minute');
INSERT INTO public.applications (job_id, helper_id, status) VALUES
  ('${JOB}', '${PENDING}', 'pending'), ('${JOB}', '${REJECTED}', 'rejected'),
  ('${JOB}', '${UNMESSAGED}', 'pending'), ('${JOB}', '${ACCEPTED_MSG}', 'accepted'),
  ('${GROUP}', '${CREW}', 'accepted'), ('${GROUP}', '${REMOVED}', 'accepted'),
  ('${DONE_1H}', '${PENDING}', 'pending'), ('${DONE_1H}', '${REJECTED}', 'rejected'),
  ('${DONE_25H}', '${PENDING}', 'pending');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${GROUP}', '${CREW}'), ('${GROUP}', '${REMOVED}');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES
  ('${JOB}', '${POSTER}', '${PENDING}', 'hi'), ('${JOB}', '${POSTER}', '${REJECTED}', 'hi'),
  ('${JOB}', '${POSTER}', '${ACCEPTED_MSG}', 'hi'),
  ('${GROUP}', '${POSTER}', '${REMOVED}', 'hi'), ('${GROUP}', '${POSTER}', '${CREW}', 'hi'),
  ('${DONE_1H}', '${POSTER}', '${PENDING}', 'hi'), ('${DONE_1H}', '${POSTER}', '${REJECTED}', 'hi'),
  ('${DONE_25H}', '${POSTER}', '${PENDING}', 'hi');
-- Removal, as the roster does it: row deleted, application accepted -> rejected.
DELETE FROM public.group_job_helpers WHERE job_id = '${GROUP}' AND helper_id = '${REMOVED}';
UPDATE public.applications SET status = 'rejected' WHERE job_id = '${GROUP}' AND helper_id = '${REMOVED}';
`;

// [label, job, sender, expected BEFORE, expected AFTER]
const CASES = [
  ["removed crew member (poster messaged them) on the group job", GROUP, REMOVED, true, false],
  ["rejected applicant (poster messaged them)", JOB, REJECTED, true, false],
  ["rejected applicant, completed job inside 24h", DONE_1H, REJECTED, true, false],
  ["current crew member", GROUP, CREW, true, true],
  ["poster of the group job", GROUP, POSTER, true, true],
  ["poster", JOB, POSTER, true, true],
  ["pending applicant the poster messaged", JOB, PENDING, true, true],
  ["accepted applicant the poster messaged", JOB, ACCEPTED_MSG, true, true],
  ["offered Helpr", JOB, OFFERED, true, true],
  ["pending applicant never messaged (poster-first lock)", JOB, UNMESSAGED, false, false],
  ["stranger", JOB, STRANGER, false, false],
  ["hired Helpr, 1h after completion (inside the window)", DONE_1H, HIRED, true, true],
  ["poster, 1h after completion", DONE_1H, POSTER, true, true],
  ["messaged pending applicant, 1h after completion", DONE_1H, PENDING, true, true],
  ["hired Helpr, 25h after completion (window closed)", DONE_25H, HIRED, false, false],
  ["poster, 25h after completion", DONE_25H, POSTER, false, false],
  ["messaged pending applicant, 25h after completion", DONE_25H, PENDING, false, false],
  ["poster, cancelled job (closed at once)", CANCELLED, POSTER, false, false],
  ["hired Helpr, cancelled job", CANCELLED, HIRED, false, false],
];

async function gate(db, job, sender) {
  return (await db.query(`SELECT public.can_message_in_job($1, $2) AS ok`, [job, sender])).rows[0].ok;
}

async function runCases(db, phase, idx) {
  for (const c of CASES) {
    const got = await gate(db, c[1], c[2]);
    check(`${phase}: ${c[0]} -> ${got ? "allowed" : "refused"}`, got === c[idx], `expected ${c[idx] ? "allowed" : "refused"}`);
  }
}

// ── BEFORE: the previous gate. The hole must be visible, or the fixture proves nothing.
{
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(OLD_GATE.stmt);
  await db.exec(DATA);
  console.log(`\n== BEFORE (${OLD_GATE.file})`);
  await runCases(db, "before", 3);
}

// ── AFTER: the new migration, 3x.
const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(OLD_GATE.stmt);
await db.exec(`REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO anon, authenticated;`);
await db.exec(DATA);
const Q410_SQL = read(Q410);
for (let i = 0; i < 3; i++) await db.exec(Q410_SQL);
console.log(`\n== AFTER (${Q410}, applied 3x)`);
await runCases(db, "after", 4);

const priv = async (role) =>
  (await db.query(`SELECT has_function_privilege($1, 'public.can_message_in_job(uuid,uuid)', 'EXECUTE') AS ok`, [role])).rows[0].ok;
check("grants: anon has NO EXECUTE (a stray anon grant is revoked by name)", (await priv("anon")) === false);
check("grants: authenticated has NO EXECUTE", (await priv("authenticated")) === false);
check("grants: service_role keeps EXECUTE", (await priv("service_role")) === true);
const def = (await db.query(`SELECT pg_get_functiondef('public.can_message_in_job(uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
check("installed body carries the live-application condition", /a\.status = ANY \(ARRAY\['pending'::application_status, 'accepted'::application_status\]\)|a\.status IN \('pending', 'accepted'\)/.test(def));
const sd = (await db.query(`SELECT prosecdef, proconfig::text AS c FROM pg_proc WHERE oid = 'public.can_message_in_job(uuid,uuid)'::regprocedure`)).rows[0];
check("still SECURITY DEFINER with search_path pinned", sd.prosecdef === true && /search_path=public/.test(sd.c), JSON.stringify(sd));

// ── Skip path: nothing to build on -> a NOTICE, twice, no error.
{
  const empty = new PGlite();
  let ok = true;
  try { await empty.exec(Q410_SQL); await empty.exec(Q410_SQL); } catch (e) { ok = false; console.log(e.message); }
  check("skip path: empty database runs the migration twice as a no-op", ok);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
