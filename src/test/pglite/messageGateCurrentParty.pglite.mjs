#!/usr/bin/env node
/**
 * PGlite proof for the messaging "off the job" rule, both directions:
 *   20260925175953_message_gate_poster_first_requires_current_party (Q705) and
 *   20260925230845_messaging_closes_both_ways_off_job (owner decision
 *   2026-09-25, Q407 addendum 14; Q420).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe npx tsx src/test/pglite/messageGateCurrentParty.pglite.mjs
 *
 * Run with tsx: it reads every function from its EFFECTIVE definition in the
 * migrations through src/test/helpers/effectiveFunctionDefs.ts (any dollar
 * tag, comments blanked with blankSqlComments, later rewrites applied), never a
 * pinned file name.
 *
 * NOTHING about the roster is simulated. A crew member is removed with a real
 * `DELETE FROM group_job_helpers`, which fires trg_sync_job_after_roster_departure
 * and the sync_job_after_roster_departure body cut from the migrations
 * (20260925140148, restated by 20260925154606); the group job's NULL helper_id
 * is enforced by the real trg_group_job_has_no_lead. On a tree without those
 * migrations the harness fails (missing definition / trigger, or the
 * application is not rejected by the delete).
 *
 * BEFORE = every definition as it stood before Q705: the hole must be visible
 * both ways (the removed crew member, the rejected applicant and the declined
 * offeree can message the poster and the poster can message them).
 * AFTER = both migrations applied 3x: those are refused both ways; the hired
 * Helpr, a pending and an accepted applicant, a pending offeree and a current
 * crew member are allowed both ways; the 24h post-completion window and the
 * cancelled-job close are unchanged. "Allowed/refused" is the whole INSERT
 * gate the messages policy calls, can_send_message_to_in_job(job, receiver),
 * evaluated as the sender.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const Q705 = "20260925175953_message_gate_poster_first_requires_current_party.sql";
const OFFJOB = "20260925230845_messaging_closes_both_ways_off_job.sql";
const read = (f) => readFileSync(DIR + f, "utf8");

const BEFORE_DEFS = effectiveDefs(DIR, { before: Q705 });

/** One function's effective statement, cut at its own closing dollar tag. */
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${Q705} defines ${name}: this tree lacks what the proof runs`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return { file: d.file, sql: `${d.stmt.slice(0, end + open[1].length)};` };
}

/** Newest `CREATE TRIGGER <name> ... ;` before Q705, located on comment-blanked text. */
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= Q705) break;
    const raw = read(f);
    const code = blankSqlComments(raw);
    const re = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi");
    for (const m of code.matchAll(re)) found = { file: f, sql: raw.slice(m.index, m.index + m[0].length) };
  }
  if (!found) throw new Error(`no migration before ${Q705} creates trigger ${name}`);
  return found;
}

const FNS = [
  "is_server_context", "job_legacy_completed_at", "job_messaging_closes_at",
  "sync_job_after_roster_departure", "enforce_group_job_has_no_lead",
  "can_message_in_job", "can_send_message_in_job", "can_send_message_to_in_job",
].map((n) => [n, fnStmt(n)]);
const TRIGGERS = ["trg_sync_job_after_roster_departure", "trg_group_job_has_no_lead"].map(triggerStmt);
for (const [n, d] of FNS) console.log(`fn ${n}: ${d.file}`);
for (const t of TRIGGERS) console.log(`trigger: ${t.file}`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), PENDING = U(2), REJECTED = U(3), UNMESSAGED = U(4), HIRED = U(5);
const OFFEREE = U(6), DECLINED = U(7), EXPIRED = U(8), CREW = U(9), REMOVED = U(10), STRANGER = U(11);
const JOB = U(101), GROUP = U(102), OFFER_P = U(103), OFFER_D = U(104), OFFER_E = U(105);
const DONE_1H = U(106), DONE_25H = U(107), CANCELLED = U(108);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
-- Stubs: bans and blocks are not what this proves.
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TYPE public.application_status AS ENUM ('pending','accepted','rejected');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  payment_status text DEFAULT 'unpaid', stripe_session_id text,
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
  helper_id uuid NOT NULL, status public.application_status NOT NULL DEFAULT 'pending', UNIQUE (job_id, helper_id));
${FNS.map(([, d]) => d.sql).join("\n")}
${TRIGGERS.map((t) => t.sql).join("\n")}
`;

const msg = (job, from, to) => `('${job}', '${from}', '${to}', 'hi')`;
const DATA = `
SELECT set_config('test.uid', '', false), set_config('test.role', 'service_role', false);
INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${JOB}', '${POSTER}', '${HIRED}', 'accepted');
INSERT INTO public.jobs (id, customer_id, status, is_group_job, helpers_needed) VALUES ('${GROUP}', '${POSTER}', 'accepted', true, 3);
INSERT INTO public.jobs (id, customer_id, offered_to_helper_id, direct_offer_status) VALUES
  ('${OFFER_P}', '${POSTER}', '${OFFEREE}', 'pending'),
  ('${OFFER_D}', '${POSTER}', '${DECLINED}', 'declined'),
  ('${OFFER_E}', '${POSTER}', '${EXPIRED}', 'expired');
INSERT INTO public.jobs (id, customer_id, helper_id, status, completed_at) VALUES
  ('${DONE_1H}',  '${POSTER}', '${HIRED}', 'completed', now() - interval '1 hour'),
  ('${DONE_25H}', '${POSTER}', '${HIRED}', 'completed', now() - interval '25 hours');
INSERT INTO public.jobs (id, customer_id, helper_id, status, cancelled_at) VALUES
  ('${CANCELLED}', '${POSTER}', '${HIRED}', 'cancelled', now() - interval '1 minute');
INSERT INTO public.applications (job_id, helper_id, status) VALUES
  ('${JOB}', '${HIRED}', 'accepted'), ('${JOB}', '${PENDING}', 'pending'),
  ('${JOB}', '${REJECTED}', 'rejected'), ('${JOB}', '${UNMESSAGED}', 'pending'),
  ('${GROUP}', '${CREW}', 'accepted'), ('${GROUP}', '${REMOVED}', 'accepted'),
  ('${DONE_1H}', '${PENDING}', 'pending'), ('${DONE_25H}', '${PENDING}', 'pending');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${GROUP}', '${CREW}'), ('${GROUP}', '${REMOVED}');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES
  ${msg(JOB, POSTER, PENDING)}, ${msg(JOB, POSTER, REJECTED)}, ${msg(JOB, POSTER, HIRED)},
  ${msg(GROUP, POSTER, REMOVED)}, ${msg(GROUP, POSTER, CREW)},
  ${msg(OFFER_P, POSTER, OFFEREE)}, ${msg(OFFER_D, POSTER, DECLINED)}, ${msg(OFFER_E, POSTER, EXPIRED)},
  ${msg(DONE_1H, POSTER, PENDING)}, ${msg(DONE_25H, POSTER, PENDING)};
`;

/** The removal, as the app does it: delete the roster row; the REAL trigger does the rest. */
const REMOVE = `DELETE FROM public.group_job_helpers WHERE job_id = '${GROUP}' AND helper_id = '${REMOVED}';`;

async function seed(db) {
  await db.exec(SCHEMA);
  await db.exec(DATA);
  // The real no-lead trigger holds the group job's helper_id at NULL.
  let refused = false;
  try { await db.exec(`UPDATE public.jobs SET helper_id = '${CREW}' WHERE id = '${GROUP}'`); } catch { refused = true; }
  check("real trg_group_job_has_no_lead refuses a lead on the group job", refused);
  await db.exec(REMOVE);
  const st = (await db.query(`SELECT status::text AS s FROM public.applications WHERE job_id = $1 AND helper_id = $2`, [GROUP, REMOVED])).rows[0]?.s;
  check("real trg_sync_job_after_roster_departure rejected the removed member's application", st === "rejected", `status=${st}`);
}

async function asUser(db, uid, sql, params) {
  await db.query(`SELECT set_config('test.uid', $1, false), set_config('test.role', 'authenticated', false)`, [uid]);
  try {
    return (await db.query(sql, params)).rows[0].ok;
  } finally {
    await db.query(`SELECT set_config('test.uid', '', false), set_config('test.role', 'service_role', false)`);
  }
}

/** The INSERT gate as the messages policy runs it, evaluated as `from`. */
const canSend = (db, job, from, to) =>
  asUser(db, from, `SELECT public.can_send_message_to_in_job($1, $2) AS ok`, [job, to]);

// [label, job, other party, expected BEFORE (both ways), expected AFTER (both ways)]
// Each row is checked other -> poster AND poster -> other.
const PAIRS = [
  ["removed crew member (real departure trigger)", GROUP, REMOVED, true, false],
  ["rejected applicant the poster messaged", JOB, REJECTED, true, false],
  ["declined offeree", OFFER_D, DECLINED, true, false],
  ["expired offeree", OFFER_E, EXPIRED, true, false],
  ["hired Helpr (accepted applicant)", JOB, HIRED, true, true],
  ["pending applicant the poster messaged", JOB, PENDING, true, true],
  ["current crew member", GROUP, CREW, true, true],
  ["pending offeree", OFFER_P, OFFEREE, true, true],
  ["hired Helpr, 1h after completion (inside the window)", DONE_1H, HIRED, true, true],
  ["pending applicant, 1h after completion", DONE_1H, PENDING, true, true],
  ["hired Helpr, 25h after completion (window closed)", DONE_25H, HIRED, false, false],
  ["pending applicant, 25h after completion", DONE_25H, PENDING, false, false],
  ["hired Helpr, cancelled job (closed at once)", CANCELLED, HIRED, false, false],
];
// One-directional rules that must not move: [label, job, from, to, BEFORE, AFTER].
const ONE_WAY = [
  ["never-messaged applicant -> poster (poster-first lock)", JOB, UNMESSAGED, POSTER, false, false],
  ["poster -> never-messaged pending applicant", JOB, POSTER, UNMESSAGED, true, true],
  ["stranger -> poster", JOB, STRANGER, POSTER, false, false],
  ["poster -> stranger", JOB, POSTER, STRANGER, false, false],
];

async function runPairs(db, phase, idx) {
  for (const p of PAIRS) {
    const up = await canSend(db, p[1], p[2], POSTER);
    const down = await canSend(db, p[1], POSTER, p[2]);
    const want = p[idx] ? "allowed" : "refused";
    check(`${phase}: ${p[0]} -> poster: ${up ? "allowed" : "refused"}`, up === p[idx], `expected ${want}`);
    check(`${phase}: poster -> ${p[0]}: ${down ? "allowed" : "refused"}`, down === p[idx], `expected ${want}`);
  }
  const oi = idx + 1;
  for (const o of ONE_WAY) {
    const got = await canSend(db, o[1], o[2], o[3]);
    check(`${phase}: ${o[0]}: ${got ? "allowed" : "refused"}`, got === o[oi], `expected ${o[oi] ? "allowed" : "refused"}`);
  }
}

// ── BEFORE: every definition as it stood before Q705. The hole must be open.
{
  const db = new PGlite();
  await seed(db);
  console.log(`\n== BEFORE (definitions before ${Q705})`);
  await runPairs(db, "before", 3);
}

// ── AFTER: Q705 then the both-ways migration, each 3x.
const db = new PGlite();
await seed(db);
// A stray client grant of the kind prod's default privileges hand out, so the
// REVOKEs below are shown to remove it.
await db.exec(`GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO anon, authenticated;`);
for (const f of [Q705, OFFJOB]) for (let i = 0; i < 3; i++) await db.exec(read(f));
console.log(`\n== AFTER (${Q705} + ${OFFJOB}, each applied 3x)`);
await runPairs(db, "after", 4);

// The client's read: get_off_job_thread_state(job, other) as the viewer.
for (const [label, viewer, job, other, want] of [
  ["rejected applicant sees their thread with the poster closed", REJECTED, JOB, POSTER, "self"],
  ["poster sees the thread with the rejected applicant closed", POSTER, JOB, REJECTED, "other"],
  ["removed crew member sees the thread closed", REMOVED, GROUP, POSTER, "self"],
  ["poster sees the thread with the removed crew member closed", POSTER, GROUP, REMOVED, "other"],
  ["declined offeree sees the thread closed", DECLINED, OFFER_D, POSTER, "self"],
  ["poster sees the thread with the declined offeree closed", POSTER, OFFER_D, DECLINED, "other"],
  ["poster with a pending applicant: open", POSTER, JOB, PENDING, null],
  ["hired Helpr with the poster: open", HIRED, JOB, POSTER, null],
  ["current crew member with the poster: open", CREW, GROUP, POSTER, null],
  ["pending offeree with the poster: open", OFFEREE, OFFER_P, POSTER, null],
  ["a stranger cannot probe a rejected applicant (no thread)", STRANGER, JOB, REJECTED, null],
]) {
  const got = await asUser(db, viewer, `SELECT public.get_off_job_thread_state($1, $2) AS ok`, [job, other]);
  check(`get_off_job_thread_state: ${label}`, got === want, `got ${got}`);
}

const fnPriv = async (role, sig) =>
  (await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])).rows[0].ok;
for (const [sig, allowed] of [
  ["public.can_message_in_job(uuid,uuid)", ["service_role"]],
  ["public.is_off_job(uuid,uuid)", ["service_role"]],
  ["public.can_send_message_to_in_job(uuid,uuid)", ["authenticated", "service_role"]],
  ["public.get_off_job_thread_state(uuid,uuid)", ["authenticated", "service_role"]],
]) {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const want = allowed.includes(role);
    check(`grants: ${role} ${want ? "has" : "has NO"} EXECUTE on ${sig}`, (await fnPriv(role, sig)) === want);
  }
}
const sd = (await db.query(`SELECT prosecdef, proconfig::text AS c FROM pg_proc WHERE oid = 'public.can_message_in_job(uuid,uuid)'::regprocedure`)).rows[0];
check("can_message_in_job still SECURITY DEFINER with search_path pinned", sd.prosecdef === true && /search_path=public/.test(sd.c), JSON.stringify(sd));

// ── Skip path: nothing to build on -> a NOTICE, twice, no error.
{
  const empty = new PGlite();
  let ok = true;
  try { for (const f of [Q705, OFFJOB]) { await empty.exec(read(f)); await empty.exec(read(f)); } } catch (e) { ok = false; console.log(e.message); }
  check("skip path: an empty database runs both migrations twice as a no-op", ok);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
