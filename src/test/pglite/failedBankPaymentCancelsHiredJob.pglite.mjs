#!/usr/bin/env node
/**
 * PGlite proof for 20261017205845_failed_bank_payment_cancels_hired_job (Q1972).
 *
 *   npx tsx src/test/pglite/failedBankPaymentCancelsHiredJob.pglite.mjs                       # RED before + GREEN after, 3x apply
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/failedBankPaymentCancelsHiredJob.pglite.mjs    # before only (RED)
 *   NEW_MIGRATION=no-backout-skip npx tsx ...                                                  # the RPC with the OLD record_backout_notice (RED)
 *
 * pglite is not a dependency (CLAUDE.md); it is loaded from $PGLITE_DIR
 * (default ~/.lh-pglite).
 *
 * Owner decision (2026-10-17): when a job's bank payment fails AFTER a Helpr
 * was hired, the job auto-cancels: no fee, no strike, the direct offer and the
 * pending applications retired, a confirmed Helpr told why, the poster told
 * plainly (bank payment failed, job cancelled, post again). Job 7440a72d
 * (accepted, hired Helpr unconfirmed, ACH insufficient_funds) is A1.
 *
 * THE BEFORE STATE is built from the migrations, not hand-listed (the shape of
 * banSettlesOneOffJobs.pglite.mjs): public.jobs as read from prod plus every
 * later ADD COLUMN; EVERY BEFORE trigger the migrations leave standing on jobs
 * and applications, each running its function's EFFECTIVE definition; and the
 * real AFTER triggers a cancel fires that write notices:
 * trg_close_pending_applications_on_job_cancel, on_job_status_change
 * (notify_on_job_update) and trg_jobs_record_backout_notice
 * (record_backout_notice). The RPC is called as service_role, the way
 * stripe-webhook calls it.
 * Stubs (not under test): are_users_blocked, backout_notice_text,
 * send_backout_email (records the email it would send), and the trigger
 * functions in STUBS.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const ROOT = new URL("../../../", import.meta.url).pathname;
const DIR = `${ROOT}supabase/migrations/`;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261017205845_failed_bank_payment_cancels_hired_job.sql";
const MIGRATION = mig(THIS);
const MODE = process.env.NEW_MIGRATION ?? "";
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
const DEFS = effectiveDefs(DIR, { before: THIS });

const LIVE = readFileSync(`${ROOT}scripts/probes/fixtures/dispute-table-door.live.sql`, "utf8");
const tableDdl = (t) => new RegExp(`^CREATE TABLE public\\.${t} \\([\\s\\S]*?^\\);`, "m").exec(LIVE)[0];
const LIVE_READ = "20260914";
const LATER_COLUMNS = BEFORE_FILES.filter((f) => f > LIVE_READ)
  .flatMap((f) => [...blankSqlComments(mig(f)).matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?public\.jobs\s+([\s\S]*?);/gi)].map((m) => m[1]))
  .flatMap((body) => [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([\w\[\]]+)/gi)].map((m) => `ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]};`))
  .join("\n");

// jobs only: the applications triggers fire on the AFTER trigger's close of a
// pending application and are not what this proves (their notice to the
// applicant is the cancel's existing side effect, unchanged here).
const TABLES = new Set(["jobs"]);
const triggers = {};
for (const f of BEFORE_FILES) {
  const s = blankSqlComments(mig(f));
  const re = /(CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+([\s\S]*?);)|(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?)/gi;
  for (const m of s.matchAll(re)) {
    if (m[1]) {
      const table = /\bON\s+(?:public\.)?"?(\w+)"?/i.exec(m[3])?.[1];
      if (!TABLES.has(table)) continue;
      triggers[`${table}.${m[2]}`] = {
        table, name: m[2], sql: m[1],
        fn: /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/i.exec(m[3])[1],
        before: /^\s*BEFORE\b/i.test(m[3]),
      };
    } else if (TABLES.has(m[6])) delete triggers[`${m[6]}.${m[5]}`];
  }
}
const AFTER_KEPT = new Set([
  "jobs.trg_close_pending_applications_on_job_cancel",
  "jobs.on_job_status_change",
  "jobs.trg_jobs_record_backout_notice",
  "jobs.job_status_system_message",
]);
const CHAIN = Object.entries(triggers)
  .filter(([k, t]) => t.before || AFTER_KEPT.has(k))
  .sort(([a], [b]) => (a < b ? -1 : 1));
for (const k of AFTER_KEPT) if (!triggers[k]) throw new Error(`${k} is not standing before ${THIS}`);

const HELPERS = [
  "is_server_context", "has_role", "is_caller_banned", "job_payment_is_funded", "helper_award_block_reason",
  "job_expires_at_for_schedule",
];
// Trigger functions replaced by a pass-through: they read tables this proof
// does not model and fire on columns the cancel never writes.
const STUBS = new Set([
  "reject_contact_leak_in_job", "validate_job_budget",
  "enforce_jobs_dispute_evidence_append_only", "enforce_application_credential_tier",
  "snapshot_application_job_point", "reject_application_when_blocked", "enforce_application_gates",
]);
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  return d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`;
}
const chainFns = [...new Set(CHAIN.map(([, t]) => t.fn))];
const FUNCTIONS = [
  ...HELPERS.filter((h) => DEFS.has(h)).map(fnStmt),
  ...chainFns.map((fn) =>
    STUBS.has(fn) || !DEFS.has(fn)
      ? `CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;`
      : fnStmt(fn)),
].join("\n\n");
const STUBBED = chainFns.filter((fn) => STUBS.has(fn) || !DEFS.has(fn));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "99999999-9999-9999-9999-999999999999";
const HELPR = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CREW2 = "33333333-3333-3333-3333-333333333333";
const J = (n) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
const PI = "pi_ach_failed";

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean, stripe_identity_verified boolean,
  idv_status text, is_seed boolean DEFAULT false, full_name text, email_verified boolean DEFAULT true,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz
);
${tableDdl("jobs")}
${LATER_COLUMNS}
ALTER TABLE public.jobs ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS series_ended_on date;
${tableDdl("notifications")}
${tableDdl("user_roles")}
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text DEFAULT 'accepted', joined_at timestamptz DEFAULT now(),
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, share_cents integer, slot_no integer
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  message text, offer_message text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired'))
);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid);
CREATE TABLE public.backout_notices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, user_id uuid, actor_name text, backout_kind text);
CREATE TABLE public.sent_backout_emails (user_id uuid, job_id uuid, title text);
-- public.gift_cards: every column as live (information_schema, 2026-10-17).
CREATE TABLE public.gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'available', message text, category text, parish text, job_id uuid,
  expires_at timestamptz DEFAULT (now() + interval '90 days'), created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz, recipient_email text, stripe_payment_intent_id text, stripe_session_id text,
  claim_token text, parent_credit_id uuid, payment_status text NOT NULL DEFAULT 'pending', occasion text,
  design_id text, restored_from_job_id uuid
);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
-- messages: the columns insert_job_status_system_message writes. Its own
-- triggers are not modelled; a system row here is what would notify the
-- receiver (notify_message_recipient), so the proof counts rows.
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, sender_id uuid, receiver_id uuid,
  content text, read boolean DEFAULT false, is_system boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.test_fixture_jobs (job_id uuid PRIMARY KEY, purpose text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Stubs (not under test).
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.backout_notice_text(p_kind text, p_actor text, p_title text, OUT title text, OUT message text)
  LANGUAGE sql AS $$ SELECT p_kind, coalesce(p_actor, 'Someone') || ' ' || p_kind $$;
CREATE FUNCTION public.send_backout_email(p_user uuid, p_job uuid, p_title text, p_message text, p_link text)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent_backout_emails VALUES (p_user, p_job, p_title) $$;

${FUNCTIONS}

${CHAIN.map(([, t]) => t.sql).join("\n")}
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
/** stripe-webhook's call: the service-role client, PostgREST rpc. */
const cancel = async (id, pi = PI, gift = null) => {
  const r = await as("service_role", null, `SELECT public.cancel_job_after_failed_bank_payment('${id}', '${pi}'${gift ? `, '${gift}'` : ""}) AS v`);
  return r.ok ? r.rows[0].v : { error: r.error };
};

const reset = () => db.exec(`
  SET session_replication_role = replica;
  DELETE FROM public.notifications; DELETE FROM public.applications; DELETE FROM public.group_job_helpers;
  DELETE FROM public.user_violations; DELETE FROM public.backout_notices; DELETE FROM public.sent_backout_emails;
  DELETE FROM public.messages; DELETE FROM public.gift_cards; DELETE FROM public.payout_transfers; DELETE FROM public.jobs;
  SET session_replication_role = origin;`);

async function seedJob(id, f) {
  const v = (x) => (x === undefined || x === null ? "NULL" : `'${x}'`);
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, date_needed, start_time,
      payment_status, stripe_session_id, stripe_payment_intent_id, helper_fee_percent, helper_confirmed_at,
      helper_completed_at, is_group_job, helpers_needed, offered_to_helper_id, direct_offer_status,
      direct_offer_expires_at, parent_job_id, recurrence_days, is_seed)
    VALUES ('${id}', '${POSTER}', ${v(f.helper)}, 'Mow & Weed Eat Yard', '${f.status}', 120,
      (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date,
      date_trunc('minute', (now() AT TIME ZONE 'America/Chicago' + interval '10 hours'))::time,
      ${v(f.pay ?? "escrow")}, 'cs_live_done', ${v(f.pi ?? PI)}, 10,
      ${f.confirmed ? "now() - interval '1 day'" : "NULL"}, ${f.done ? "now() - interval '1 hour'" : "NULL"},
      ${f.crew ? "true" : "false"}, ${f.crew ? 2 : 1}, ${v(f.offeredTo)}, ${v(f.offerStatus)},
      ${f.offerStatus === "pending" ? "now() + interval '1 day'" : "NULL"}, ${v(f.parent)},
      ${f.recurring ? "ARRAY[1]::smallint[]" : "NULL"}, true);
    SET session_replication_role = origin;`);
}
const raw = (sql) => db.exec(`SET session_replication_role = replica; ${sql}; SET session_replication_role = origin;`);
const job = (id) => one(`SELECT status::text AS status, payment_status, stripe_session_id, helper_id,
  cancellation_fee::text AS fee, late_cancellation AS late, cancellation_fee_status AS fee_status, cancelled_by,
  cancelled_at IS NOT NULL AS has_cancelled_at, cancellation_reason, direct_offer_status FROM public.jobs WHERE id = '${id}'`);
const notes = (uid) => all(`SELECT title, message, link, job_id FROM public.notifications WHERE user_id = '${uid}' ORDER BY title`);
const counts = async () => one(`SELECT
  (SELECT count(*)::int FROM public.backout_notices) AS backouts,
  (SELECT count(*)::int FROM public.sent_backout_emails) AS emails,
  (SELECT count(*)::int FROM public.user_violations) AS strikes,
  (SELECT count(*)::int FROM public.notifications) AS notices`);

// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
await db.exec(`INSERT INTO auth.users (id) VALUES ('${POSTER}'), ('${HELPR}'), ('${OTHER}'), ('${CREW2}');
  INSERT INTO public.profiles (user_id, is_seed, full_name) VALUES ('${POSTER}', true, 'Poster'), ('${HELPR}', true, 'Yusef'), ('${OTHER}', true, 'Other'), ('${CREW2}', true, 'Crew');`);
console.log(`chain: ${CHAIN.length} triggers on ${[...TABLES].join("/")} (${STUBBED.length} functions stubbed: ${STUBBED.join(", ")})`);

if (MODE === "skip" || MODE === "") {
  console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
  await reset();
  await seedJob(J(1), { status: "accepted", helper: HELPR });
  const r = await cancel(J(1));
  check("R1 there is no sanctioned way to cancel a hired job whose bank payment failed (the RPC does not exist)",
    /does not exist/.test(String(r.error)), JSON.stringify(r));
  const s = await job(J(1));
  check("R2 so the 7440a72d-shaped job stays hired", s.status === "accepted" && s.helper_id === HELPR, JSON.stringify(s));
  if (MODE === "skip") {
    console.log(failures ? `${failures} FAILED` : "BEFORE reproduced (R1..R2)");
    process.exit(failures ? 1 : 0);
  }
  if (failures) process.exit(1);
}

if (MODE === "no-backout-skip") {
  // The RPC alone, with the record_backout_notice the database runs today.
  const rpcOnly = MIGRATION.slice(0, MIGRATION.indexOf("-- record_backout_notice: newest definition"));
  await db.exec(rpcOnly);
  await reset();
  await seedJob(J(1), { status: "accepted", helper: HELPR });
  const v = await cancel(J(1));
  const c = await counts();
  check("RB the cancel lands", v?.outcome === "cancelled", JSON.stringify(v));
  check("RB WITHOUT the restated record_backout_notice, the unconfirmed Helpr gets a 'poster cancelled' back-out notice and email",
    c.backouts === 0 && c.emails === 0, JSON.stringify(c));
  console.log(failures ? `${failures} FAILED (expected: proves the restatement is needed)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

console.log("\n── apply the migration 3x (replay-safe) ─────────────────────────");
for (let i = 1; i <= 3; i++) {
  await db.exec(MIGRATION);
  console.log(`  applied ${i}x`);
}
const acl = await one(`SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.proname = 'cancel_job_after_failed_bank_payment'`);
check("the RPC is executable by service_role only (not anon/authenticated/PUBLIC)",
  !/(^|[{,])(anon|authenticated)?=X/.test(acl.acl) && /service_role=X/.test(acl.acl), acl.acl);
await reset();
await seedJob(J(9), { status: "accepted", helper: HELPR });
const authCall = await as("authenticated", POSTER, `SELECT public.cancel_job_after_failed_bank_payment('${J(9)}', '${PI}')`);
check("a signed-in member cannot call it", !authCall.ok && /permission denied/.test(authCall.error), authCall.error);

console.log("\n── AFTER: named cases ───────────────────────────────────────────");
// A1: 7440a72d. Accepted, hired Helpr NOT confirmed, a pending application from someone else.
await reset();
await seedJob(J(1), { status: "accepted", helper: HELPR });
await raw(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(1)}', '${OTHER}', 'pending'), ('${J(1)}', '${HELPR}', 'accepted')`);
let v = await cancel(J(1));
let s = await job(J(1));
let c = await counts();
check("A1 7440a72d: outcome cancelled", v?.outcome === "cancelled", JSON.stringify(v));
check("A1 job cancelled, payment_status failed, session cleared", s.status === "cancelled" && s.payment_status === "failed" && s.stripe_session_id === null, JSON.stringify(s));
check("A1 no fee, not late, no fee status, nobody named as the canceller", Number(s.fee) === 0 && s.late === false && s.fee_status === null && s.cancelled_by === null && s.has_cancelled_at, JSON.stringify(s));
check("A1 the reason says the bank payment failed", /bank payment/.test(String(s.cancellation_reason)));
const a1app = await one(`SELECT status, closed_reason FROM public.applications WHERE job_id='${J(1)}' AND helper_id='${OTHER}'`);
check("A1 the pending application is closed as job_cancelled (the real AFTER trigger)", a1app.status === "rejected" && a1app.closed_reason === "job_cancelled", JSON.stringify(a1app));
const p1 = await notes(POSTER);
check("A1 the poster gets ONE notice: bank payment failed, job cancelled, no fee, can post again",
  p1.length === 1 && /bank payment .* didn't go through/.test(p1[0].message) && /cancelled/.test(p1[0].message)
    && /no cancellation fee/.test(p1[0].message) && /post it again/.test(p1[0].message) && p1[0].job_id === J(1),
  JSON.stringify(p1));
check("A1 the poster is not told a Helpr was informed (nobody was)", !/let your Helpr/.test(p1[0]?.message ?? ""));
check("A1 the unconfirmed Helpr is NOT told: no notice, no back-out notice, no email", (await notes(HELPR)).length === 0 && c.backouts === 0 && c.emails === 0, JSON.stringify(c));
check("A1 no strike to anyone", c.strikes === 0);
check("A1 the poster's notice is the only notice", c.notices === 1, JSON.stringify(c));

// A1b: the same failure delivered again (Stripe retries): nothing more happens.
v = await cancel(J(1));
c = await counts();
check("A1b a redelivery is moved_on and sends nothing more", v?.outcome === "moved_on" && c.notices === 1, JSON.stringify({ v, c }));

const sysRows = async () => (await one(`SELECT count(*)::int AS n FROM public.messages WHERE is_system`)).n;

// A1c: the unconfirmed Helpr has a message thread with the poster: no
// "✕ Job cancelled" thread row reaches them (it would notify them).
await reset();
await seedJob(J(11), { status: "accepted", helper: HELPR });
await raw(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J(11)}', '${HELPR}', '${POSTER}', 'On my way Saturday')`);
v = await cancel(J(11));
check("A1c a thread participant gets no system 'Job cancelled' row (no message notice to an unconfirmed Helpr)", v?.outcome === "cancelled" && (await sysRows()) === 0, JSON.stringify({ v, rows: await sysRows() }));
// Control: the trigger is live in this proof: an ordinary status change still writes its row.
await raw(`UPDATE public.jobs SET status = 'accepted', payment_status = 'escrow' WHERE id = '${J(11)}'`);
await as("service_role", null, `UPDATE public.jobs SET status = 'in_progress' WHERE id = '${J(11)}'`);
check("A1c control: the system-message trigger runs here (an ordinary move writes its row)", (await sysRows()) === 1, String(await sysRows()));

// A2: hired and confirmed.
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true });
v = await cancel(J(2));
s = await job(J(2));
c = await counts();
const h2 = await notes(HELPR);
const p2 = await notes(POSTER);
check("A2 confirmed: cancelled, failed, no fee", v?.outcome === "cancelled" && s.status === "cancelled" && s.payment_status === "failed" && Number(s.fee) === 0, JSON.stringify(s));
check("A2 the confirmed Helpr gets ONE notice: cancelled because the payment didn't go through, doesn't count against them",
  h2.length === 1 && /cancelled because the poster's payment didn't go through/.test(h2[0].message) && /doesn't count against you/.test(h2[0].message)
    && /don't start work/.test(h2[0].message) && h2[0].link === `/jobs?job=${J(2)}`,
  JSON.stringify(h2));
check("A2 no generic 'cancelled by the poster' notice, no back-out notice or email", !h2.some((n) => /by the poster/.test(n.message)) && c.backouts === 0 && c.emails === 0, JSON.stringify(c));
check("A2 the poster is told the Helpr was let know", p2.length === 1 && /let your Helpr know/.test(p2[0].message), JSON.stringify(p2));
check("A2 no strike", c.strikes === 0);
check("A2 verdict names who was told", JSON.stringify(v?.helpers_told) === JSON.stringify([HELPR]), JSON.stringify(v));

// A3: in progress: the Helpr is asked to stop.
await reset();
await seedJob(J(3), { status: "in_progress", helper: HELPR, confirmed: true });
v = await cancel(J(3));
const h3 = await notes(HELPR);
check("A3 in_progress: cancelled and the Helpr is asked to stop work", v?.outcome === "cancelled" && h3.length === 1 && /stop work/.test(h3[0].message), JSON.stringify(h3));

// A4: an open job with a pending DIRECT OFFER (nobody hired yet) is retired too.
await reset();
await seedJob(J(4), { status: "open", offeredTo: OTHER, offerStatus: "pending" });
v = await cancel(J(4));
s = await job(J(4));
c = await counts();
check("A4 pending direct offer: cancelled and the offer retired (expired)", v?.outcome === "cancelled" && s.status === "cancelled" && s.direct_offer_status === "expired", JSON.stringify(s));
check("A4 the offeree is not told and the poster gets no 'offer expired' back-out", (await notes(OTHER)).length === 0 && c.backouts === 0 && c.emails === 0, JSON.stringify(c));

// A5: a crew. Only confirmed members are told.
await reset();
await seedJob(J(5), { status: "accepted", crew: true });
await raw(`INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at) VALUES ('${J(5)}', '${HELPR}', now()), ('${J(5)}', '${CREW2}', NULL)`);
v = await cancel(J(5));
s = await job(J(5));
check("A5 crew: cancelled", v?.outcome === "cancelled" && s.status === "cancelled" && s.payment_status === "failed", JSON.stringify({ v, s }));
check("A5 the confirmed member is told, the unconfirmed one is not", (await notes(HELPR)).length === 1 && (await notes(CREW2)).length === 0);
const p5 = await notes(POSTER);
check("A5 the poster is told", p5.length === 1 && /let your Helpr know/.test(p5[0].message), JSON.stringify(p5));

// A6: nobody hired: left to the caller's un-fund.
await reset();
await seedJob(J(6), { status: "open" });
v = await cancel(J(6));
s = await job(J(6));
check("A6 nobody hired: not_hired, job untouched", v?.outcome === "not_hired" && s.status === "open" && s.payment_status === "escrow" && (await counts()).notices === 0, JSON.stringify({ v, s }));

// A7: work done / not a plain one-off: left to a person (the caller pages).
for (const [label, f] of [
  ["completed + payout_pending", { status: "completed", helper: HELPR, confirmed: true, done: true, pay: "payout_pending" }],
  ["marked done", { status: "in_progress", helper: HELPR, confirmed: true, done: true }],
  ["disputed", { status: "disputed", helper: HELPR, confirmed: true }],
  ["revision_requested", { status: "revision_requested", helper: HELPR, confirmed: true }],
  ["recurring parent", { status: "accepted", helper: HELPR, confirmed: true, recurring: true }],
]) {
  await reset();
  await seedJob(J(7), f);
  v = await cancel(J(7));
  s = await job(J(7));
  check(`A7 ${label}: not_cancellable, job untouched`, v?.outcome === "not_cancellable" && s.status === f.status && s.payment_status === (f.pay ?? "escrow") && (await counts()).notices === 0, JSON.stringify({ v, s }));
}
await reset();
await seedJob(J(7), { status: "accepted", crew: true });
await raw(`INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at, helper_completed_at) VALUES ('${J(7)}', '${HELPR}', now(), now())`);
v = await cancel(J(7));
check("A7 crew with a member's part done: not_cancellable", v?.outcome === "not_cancellable", JSON.stringify(v));

// A8: moved on.
for (const [label, f, pi] of [
  ["another PI", { status: "accepted", helper: HELPR }, "pi_other"],
  ["refunded", { status: "accepted", helper: HELPR, pay: "refunded" }, PI],
  ["released", { status: "completed", helper: HELPR, confirmed: true, pay: "released" }, PI],
  ["already failed", { status: "accepted", helper: HELPR, pay: "failed" }, PI],
]) {
  await reset();
  await seedJob(J(8), f);
  v = await cancel(J(8), pi);
  s = await job(J(8));
  check(`A8 ${label}: moved_on, nothing written`, v?.outcome === "moved_on" && s.status === f.status && (await counts()).notices === 0, JSON.stringify({ v, s }));
}

// ── G: a job part-paid by a gift card (lead, 2026-10-17) ─────────────────────
// return_bounced_gift_card is Q1876's (20261017074500, on the sec-a train).
// Until that migration is in this tree, RETURN_BOUNCED_GIFT_SQL names a copy
// of it; with neither, the G cases FAIL rather than skip.
console.log("\n── G: gift-card part-paid job ───────────────────────────────────");
const GIFT = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";
let giftSql = DEFS.has("return_bounced_gift_card") ? fnStmt("return_bounced_gift_card") : null;
if (!giftSql && process.env.RETURN_BOUNCED_GIFT_SQL) giftSql = readFileSync(process.env.RETURN_BOUNCED_GIFT_SQL, "utf8");
check("G0 return_bounced_gift_card is available to this proof", !!giftSql);
const seedGift = (f = {}) => raw(`INSERT INTO public.gift_cards (id, recipient_id, amount, status, job_id, redeemed_at, payment_status)
  VALUES ('${GIFT}', '${POSTER}', 40, 'redeemed', '${f.job ?? J(10)}', now(), '${f.pay ?? "paid"}')`);
const gift = () => one(`SELECT status, job_id, payment_status FROM public.gift_cards WHERE id = '${GIFT}'`);

// G3 first: the cancel still lands before Q1876 is deployed, and says so.
await reset();
await seedJob(J(10), { status: "accepted", helper: HELPR });
await seedGift();
v = await cancel(J(10), PI, GIFT);
let g = await gift();
check("G3 before return_bounced_gift_card exists: cancelled, gift.outcome not_deployed, gift untouched (the handler pages)",
  v?.outcome === "cancelled" && v?.gift?.outcome === "not_deployed" && g.status === "redeemed" && g.job_id === J(10), JSON.stringify({ v, g }));
check("G3 the poster is not told the gift is back", !/gift card is back/.test((await notes(POSTER))[0]?.message ?? ""));

if (giftSql) {
  await db.exec(giftSql);
  // G1: the 7440a72d shape with a $40 gift spent by the completed ACH checkout.
  await reset();
  await seedJob(J(10), { status: "accepted", helper: HELPR, confirmed: true });
  await seedGift();
  v = await cancel(J(10), PI, GIFT);
  g = await gift();
  const p10 = await notes(POSTER);
  check("G1 cancelled, and the SAME gift row is back on the poster's balance (sent, no job)",
    v?.outcome === "cancelled" && v?.gift?.outcome === "returned" && g.status === "sent" && g.job_id === null, JSON.stringify({ v, g }));
  check("G1 the poster's one notice says the gift card is back", p10.length === 1 && /gift card is back in your account/.test(p10[0].message), JSON.stringify(p10));
  // G2: exactly once. A redelivery, and C's own retry path, find nothing to return.
  v = await cancel(J(10), PI, GIFT);
  const again = await as("service_role", null, `SELECT public.return_bounced_gift_card('${J(10)}', '${GIFT}') AS v`);
  const n = await one(`SELECT count(*)::int AS n FROM public.gift_cards`);
  check("G2 exactly once: a redelivery is moved_on, return_bounced_gift_card answers not_consumed, still one gift row",
    v?.outcome === "moved_on" && again.rows?.[0]?.v?.outcome === "not_consumed" && n.n === 1 && (await gift()).status === "sent",
    JSON.stringify({ v, again: again.rows?.[0]?.v ?? again.error, n }));
  check("G2 and no second notice", (await notes(POSTER)).length === 1);
  // G4: a gift whose donation was refunded comes back unspendable: no promise.
  await reset();
  await seedJob(J(10), { status: "accepted", helper: HELPR });
  await seedGift({ pay: "refunded" });
  v = await cancel(J(10), PI, GIFT);
  check("G4 a refunded-donation gift is returned but the poster is not promised a usable gift",
    v?.gift?.outcome === "returned" && !/gift card is back/.test((await notes(POSTER))[0]?.message ?? ""), JSON.stringify(v));
  // G5: a cancel that does NOT happen (nobody hired) never touches the gift.
  await reset();
  await seedJob(J(10), { status: "open" });
  await seedGift();
  v = await cancel(J(10), PI, GIFT);
  check("G5 not_hired leaves the gift spent for the un-fund path (Q1975)", v?.outcome === "not_hired" && (await gift()).status === "redeemed", JSON.stringify(v));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
