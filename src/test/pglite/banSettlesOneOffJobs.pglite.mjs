#!/usr/bin/env node
/**
 * PGlite proof for 20260925234251_permanent_ban_settles_one_off_jobs (docs/OPEN.md Q327).
 *
 *   npx tsx src/test/pglite/banSettlesOneOffJobs.pglite.mjs                 # RED before + GREEN after, 3x apply
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/banSettlesOneOffJobs.pglite.mjs   # before only (RED)
 *
 * pglite is not a dependency (CLAUDE.md); it is loaded from $PGLITE_DIR
 * (default ~/.lh-pglite).
 *
 * THE BEFORE STATE is what prod holds without this migration, built from the
 * migrations, not hand-listed:
 *   - public.jobs as read from prod (scripts/probes/fixtures/dispute-table-door
 *     .live.sql, 2026-09-14) plus every later `ALTER TABLE public.jobs ADD COLUMN`;
 *   - EVERY BEFORE trigger the migrations leave standing on jobs, disputes and
 *     applications (found by scanning CREATE/DROP TRIGGER), each running its
 *     function's EFFECTIVE definition (src/test/helpers/effectiveFunctionDefs.ts:
 *     any dollar tag, later pg_get_functiondef rewrites applied);
 *   - the real AFTER trigger that closes a cancelled job's pending applications
 *     (trg_close_pending_applications_on_job_cancel) and the helpers the
 *     settlement prices with (job_hours_until_start, cancellation_fee_percent,
 *     is_late_cancellation) and poster_cancel_job itself.
 * The ban is written the way prod writes it: an UPDATE of profiles.ban_status
 * as service_role (admin-user-actions' admin client), so every jobs write runs
 * the real chain in the real context.
 * Stubs (not under test): is_caller_banned, are_users_blocked, log_notification,
 * apply_job_denial_consequence, apply_consequence_ladder, and the trigger
 * functions in STUBS (they read tables this proof does not model).
 *
 * RED-BEFORE: banning a poster / a hired Helpr leaves every live job exactly as
 * it was (R1..R4).
 * AFTER: A1.. below, then the CLASS SWEEP: every job_status x every
 * jobs_payment_status_check value (and NULL) x both seats x work started or not
 * is seeded one at a time and the account banned; no combination may end
 * 'unhandled' or 'failed', and every one must leave the job settled, held
 * (escalated dispute) or named to admins.
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
const THIS = "20260925234251_permanent_ban_settles_one_off_jobs.sql";
const MIGRATION = mig(THIS);
const MODE = process.env.NEW_MIGRATION ?? "";
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
const DEFS = effectiveDefs(DIR, { before: THIS });

// ── tables: jobs/disputes/notifications as read from prod + later columns ────
const LIVE = readFileSync(`${ROOT}scripts/probes/fixtures/dispute-table-door.live.sql`, "utf8");
const tableDdl = (t) => new RegExp(`^CREATE TABLE public\\.${t} \\([\\s\\S]*?^\\);`, "m").exec(LIVE)[0];
const LIVE_READ = "20260914";
const LATER_COLUMNS = BEFORE_FILES.filter((f) => f > LIVE_READ)
  .flatMap((f) => [...blankSqlComments(mig(f)).matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?public\.jobs\s+([\s\S]*?);/gi)].map((m) => m[1]))
  .flatMap((body) => [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([\w\[\]]+)/gi)].map((m) => `ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]};`))
  .join("\n");

// ── every standing trigger on the tables the settlement writes ───────────────
const TABLES = new Set(["jobs", "disputes", "applications"]);
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
const AFTER_KEPT = new Set(["jobs.trg_close_pending_applications_on_job_cancel"]);
const CHAIN = Object.entries(triggers)
  .filter(([k, t]) => t.before || AFTER_KEPT.has(k))
  .sort(([a], [b]) => (a < b ? -1 : 1));
for (const k of AFTER_KEPT) if (!triggers[k]) throw new Error(`${k} is not standing before ${THIS}`);

const HELPERS = [
  "is_server_context", "has_role", "is_caller_banned", "job_payment_is_funded", "helper_award_block_reason",
  "job_expires_at_for_schedule", "poster_cancel_job", "job_hours_until_start", "cancellation_fee_percent",
  "is_late_cancellation", "apply_cancellation_violation_consequence", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents",
];
// Trigger functions replaced by a pass-through: they read tables this proof
// does not model and fire on columns the settlement never writes.
const STUBS = new Set([
  "reject_contact_leak_in_job", "validate_job_budget",
  "enforce_jobs_dispute_evidence_append_only", "enforce_application_credential_tier",
  "snapshot_application_job_point", "enforce_dispute_evidence_append_only",
  "reject_application_when_blocked", "enforce_application_gates",
]);
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  return d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`;
}
const chainFns = [...new Set(CHAIN.map(([, t]) => t.fn))];
const FUNCTIONS = [
  ...HELPERS.map(fnStmt),
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
const ADMIN = "55555555-5555-5555-5555-555555555555";
const J = (n) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;

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
${tableDdl("disputes")}
CREATE UNIQUE INDEX disputes_one_open_per_job_idx ON public.disputes USING btree (job_id) WHERE (status = 'open'::text);
${tableDdl("notifications")}
${tableDdl("user_roles")}
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text DEFAULT 'accepted', joined_at timestamptz DEFAULT now(),
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, share_cents integer, slot_no integer
);
CREATE TABLE public.crew_cancellation_fee_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, committed boolean,
  share_basis_cents integer, fee_percent integer, share_amount numeric, UNIQUE (job_id, helper_id)
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  message text, offer_message text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked'))
);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE USING (auth.uid() = helper_id);

-- Stubs (not under test).
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action','record') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_violations (user_id, violation_type, job_id) VALUES (p_user, p_violation_type, p_job_id);
  RETURN jsonb_build_object('action', 'warning', 'prior_count', p_prior_count);
END $$;

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
/** admin-user-actions' write: the service-role client updates ban_status. */
const ban = (uid, status = "permanently_banned") =>
  as("service_role", null, `UPDATE public.profiles SET ban_status = '${status}' WHERE user_id = '${uid}' RETURNING user_id`);
const unbanAll = () => db.exec(`UPDATE public.profiles SET ban_status = 'active'`);

const reset = () => db.exec(`
  SET session_replication_role = replica;
  DELETE FROM public.notifications; DELETE FROM public.applications; DELETE FROM public.disputes;
  DELETE FROM public.group_job_helpers; DELETE FROM public.user_violations; DELETE FROM public.jobs;
  SET session_replication_role = origin;
  UPDATE public.profiles SET ban_status = 'active';`);

/**
 * Seed one job directly (triggers off: seeding is not what is under test).
 * hoursOut: start relative to now, America/Chicago.
 */
async function seedJob(id, f) {
  const hoursOut = f.hoursOut ?? 10;
  const v = (x) => (x === undefined || x === null ? "NULL" : typeof x === "string" && !x.startsWith("now()") && !x.startsWith("ARRAY") ? `'${x}'` : x);
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, date_needed, start_time,
      payment_status, stripe_session_id, stripe_payment_intent_id, helper_fee_percent, helper_confirmed_at,
      helper_arrived_at, helper_completed_at, proof_before_urls, is_group_job, helpers_needed,
      offered_to_helper_id, direct_offer_status, parent_job_id, recurrence_days, dispute_status, is_seed)
    VALUES ('${id}', ${v(f.customer ?? POSTER)}, ${v(f.helper)}, ${v(f.title ?? "Haul a couch")}, '${f.status}', ${f.budget ?? 200},
      (now() AT TIME ZONE 'America/Chicago' + interval '${hoursOut} hours')::date,
      date_trunc('minute', (now() AT TIME ZONE 'America/Chicago' + interval '${hoursOut} hours'))::time,
      ${v(f.pay === undefined ? "escrow" : f.pay)}, 'cs_test_q327', ${f.pay === "escrow" || f.pay === undefined ? "'pi_test_q327'" : "NULL"}, 10,
      ${f.confirmed ? "now() - interval '2 days'" : "NULL"},
      ${f.arrived ? "now() - interval '1 hour'" : "NULL"}, ${f.done ? "now() - interval '10 minutes'" : "NULL"},
      ${f.photos ? "ARRAY['https://x/before.jpg']" : "NULL"}, ${f.crew ? "true" : "false"}, ${f.crew ? 2 : 1},
      ${v(f.offeredTo)}, ${v(f.offerStatus)}, ${v(f.parent)}, ${f.recurring ? "ARRAY[1]::smallint[]" : "NULL"}, ${v(f.disputeStatus)}, true);
    SET session_replication_role = origin;`);
}
const seedApp = (sql) => db.exec(`SET session_replication_role = replica; ${sql}; SET session_replication_role = origin;`);
const job = (id) => one(`SELECT status::text AS status, payment_status, helper_id, helper_confirmed_at IS NOT NULL AS confirmed,
  cancellation_fee::text AS fee, late_cancellation AS late, cancellation_fee_status AS fee_status, cancelled_by,
  cancellation_reason, dispute_status, disputed_by, direct_offer_status FROM public.jobs WHERE id = '${id}'`);
const notes = (uid) => all(`SELECT title, message, type, link, job_id FROM public.notifications WHERE user_id = '${uid}' ORDER BY title`);
const adminNotes = () => all(`SELECT message, link, job_id FROM public.notifications WHERE user_id = '${ADMIN}' AND type = 'admin_alert'`);

// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
await db.exec(`INSERT INTO auth.users (id) VALUES ('${POSTER}'), ('${HELPR}'), ('${OTHER}'), ('${ADMIN}');
  INSERT INTO public.profiles (user_id, is_seed, full_name) VALUES ('${POSTER}', true, 'Poster'), ('${HELPR}', true, 'Helpr'), ('${OTHER}', true, 'Other'), ('${ADMIN}', true, 'Admin');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);
console.log(`chain: ${CHAIN.length} triggers on ${[...TABLES].join("/")} (${STUBBED.length} functions stubbed: ${STUBBED.join(", ")})`);
console.log(`  ${CHAIN.map(([k]) => k).join(", ")}`);

async function redScenarios(phase) {
  await reset();
  await seedJob(J(1), { status: "open", pay: "escrow" });
  await seedApp(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(1)}', '${OTHER}', 'pending')`);
  await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
  const b = await ban(POSTER);
  const r1 = await job(J(1)); const r2 = await job(J(2));
  const app = await one(`SELECT status FROM public.applications WHERE job_id='${J(1)}'`);
  await reset();
  await seedJob(J(3), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
  const b2 = await ban(HELPR);
  const r3 = await job(J(3));
  return { banOk: b.ok && b2.ok, r1, r2, app, r3 };
}

if (MODE === "skip" || !process.env.NEW_MIGRATION_ONLY) {
  console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
  const before = await redScenarios("before");
  check("R0 the ban itself lands (service_role)", before.banOk);
  check("R1 banned poster's funded OPEN job stays open", before.r1.status === "open", JSON.stringify(before.r1));
  check("R2 banned poster's application on it stays pending", before.app.status === "pending");
  check("R3 banned poster's ACCEPTED job stays accepted with the Helpr waiting", before.r2.status === "accepted", JSON.stringify(before.r2));
  check("R4 banned Helpr stays hired on an accepted job", before.r3.status === "accepted" && before.r3.helper_id === HELPR, JSON.stringify(before.r3));
  if (MODE === "skip") {
    console.log(failures ? `${failures} FAILED` : "BEFORE reproduced (R1..R4 observed: a ban settles nothing)");
    process.exit(failures ? 1 : 0);
  }
  if (failures) {
    console.log(`${failures} FAILED in the before state`);
    process.exit(1);
  }
}

console.log("\n── apply the migration 3x (replay-safe) ─────────────────────────");
for (let i = 1; i <= 3; i++) {
  await db.exec(MIGRATION);
  console.log(`  applied ${i}x`);
}
check("the trigger exists once", (await one(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_settle_one_off_jobs_on_permanent_ban'`)).n === 1);
const acl = await one(`SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.proname = 'settle_one_off_jobs_for_banned_account'`);
check("settle_one_off_jobs_for_banned_account is not executable by anon/authenticated/PUBLIC",
  !/(^|[{,])(anon|authenticated)?=X/.test(acl.acl) && /service_role=X/.test(acl.acl), acl.acl);

console.log("\n── AFTER: named cases ───────────────────────────────────────────");
// A1: poster banned, funded open job with a pending application and a pending direct offer.
await reset();
await seedJob(J(1), { status: "open", pay: "escrow", offeredTo: OTHER, offerStatus: "pending" });
await seedApp(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(1)}', '${HELPR}', 'pending')`);
let r = await ban(POSTER);
let s = await job(J(1));
check("A1 the ban lands", r.ok && r.rows.length === 1, r.error);
check("A1 funded open job -> cancelled, no fee, still escrow (void-cancelled-payments refunds it)",
  s.status === "cancelled" && Number(s.fee) === 0 && s.payment_status === "escrow" && s.cancelled_by === null && s.late === false, JSON.stringify(s));
check("A1 its pending direct offer is declined", s.direct_offer_status === "declined");
const a1app = await one(`SELECT status, closed_reason FROM public.applications WHERE job_id='${J(1)}'`);
check("A1 its pending application is closed as job_cancelled (the real AFTER trigger)", a1app.status === "rejected" && a1app.closed_reason === "job_cancelled", JSON.stringify(a1app));
const a1off = await notes(OTHER);
check("A1 the offeree is told the offer closed, no role noun", a1off.length === 1 && /offer is closed/.test(a1off[0].message) && !/poster|customer|helper/i.test(a1off[0].message), JSON.stringify(a1off));
check("A1 the banned poster is not notified", (await notes(POSTER)).length === 0);

// A2: poster banned, accepted, funded, confirmed, 10h out -> 25% fee to the Helpr.
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
await ban(POSTER);
s = await job(J(2));
check("A2 confirmed booking 10h out -> cancelled, 25% of $200 = $50, late, fee pending",
  s.status === "cancelled" && Number(s.fee) === 50 && s.late === true && s.fee_status === "pending" && s.payment_status === "escrow", JSON.stringify(s));
let hn = await notes(HELPR);
check("A2 the Helpr is told, with their cut ($50 - 10% = $45.00), role-neutral",
  hn.length === 1 && /\$45\.00/.test(hn[0].message) && hn[0].job_id === J(2) && !/poster|customer|helper/i.test(hn[0].message), JSON.stringify(hn));
// Same price as poster_cancel_job for the same job.
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
const pc = await as("authenticated", POSTER, `SELECT public.poster_cancel_job('${J(2)}', 'x') AS v`);
const pcs = await job(J(2));
check("A2 the fee equals poster_cancel_job's for the same job", pc.ok && Number(pcs.fee) === 50, JSON.stringify({ pc, pcs }));

// A3/A4: no fee when >24h out, or the hire never confirmed.
await reset();
await seedJob(J(3), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 48 });
await seedJob(J(4), { status: "accepted", helper: OTHER, confirmed: false, hoursOut: 1 });
await ban(POSTER);
s = await job(J(3));
check("A3 confirmed booking 48h out -> cancelled, $0", s.status === "cancelled" && Number(s.fee) === 0 && s.late === false, JSON.stringify(s));
s = await job(J(4));
check("A4 unconfirmed hire 1h out -> cancelled, $0", s.status === "cancelled" && Number(s.fee) === 0, JSON.stringify(s));

// A5: poster banned mid-job (Helpr arrived) -> escalated platform dispute, escrow held.
await reset();
await seedJob(J(5), { status: "in_progress", helper: HELPR, confirmed: true, arrived: true, hoursOut: -1 });
await ban(POSTER);
s = await job(J(5));
const d5 = await one(`SELECT count(*)::int AS n, bool_and(opener_id IS NULL) AS sys, max(status) AS st FROM public.disputes WHERE job_id='${J(5)}'`);
check("A5 work started -> disputed + ESCALATED, escrow untouched, no fee", s.status === "disputed" && s.dispute_status === "escalated" && s.payment_status === "escrow" && s.disputed_by === null, JSON.stringify(s));
check("A5 one platform-filed (opener NULL) open dispute row", d5.n === 1 && d5.sys === true && d5.st === "open", JSON.stringify(d5));
hn = await notes(HELPR);
check("A5 the Helpr is told it is on hold for review", hn.length === 1 && /on hold/.test(hn[0].message) && hn[0].link === `/jobs?job=${J(5)}`, JSON.stringify(hn));
check("A5 admins get an admin_alert naming the job", (await adminNotes()).some((n) => n.job_id === J(5) && n.link === `/admin?view=jobs&job=${J(5)}`));

// A6: poster banned, never-paid open job -> cancelled, no fee, payment untouched.
await reset();
await seedJob(J(6), { status: "open", pay: "unpaid" });
await ban(POSTER);
s = await job(J(6));
check("A6 unpaid open job -> cancelled, $0, still unpaid (Part B2 expires its checkout)", s.status === "cancelled" && Number(s.fee) === 0 && s.payment_status === "unpaid", JSON.stringify(s));

// A7: Helpr banned on a confirmed, funded booking 10h out -> reopened, escrow kept, no fee ever.
await reset();
await seedJob(J(7), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
await seedApp(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(7)}', '${HELPR}', 'accepted')`);
await ban(HELPR);
s = await job(J(7));
check("A7 banned Helpr's booking -> open, no Helpr, unconfirmed, escrow kept", s.status === "open" && s.helper_id === null && s.confirmed === false && s.payment_status === "escrow", JSON.stringify(s));
check("A7 their accepted application is rejected", (await one(`SELECT status FROM public.applications WHERE job_id='${J(7)}'`)).status === "rejected");
let pn = await notes(POSTER);
check("A7 the poster is told it is open again, escrow protected", pn.length === 1 && /open to everyone again/.test(pn[0].message) && /escrow/.test(pn[0].message), JSON.stringify(pn));
const c7 = await as("authenticated", POSTER, `SELECT public.poster_cancel_job('${J(7)}', 'x') AS v`);
s = await job(J(7));
check("A7 the poster can then cancel for $0: no fee can ever reach the banned Helpr", c7.ok && s.status === "cancelled" && Number(s.fee) === 0, JSON.stringify({ c7, s }));

// A8: Helpr banned mid-job with a before photo -> escalated dispute.
await reset();
await seedJob(J(8), { status: "in_progress", helper: HELPR, confirmed: true, photos: true, hoursOut: -1 });
await ban(HELPR);
s = await job(J(8));
check("A8 banned Helpr with work started -> disputed + ESCALATED, escrow held", s.status === "disputed" && s.dispute_status === "escalated" && s.payment_status === "escrow", JSON.stringify(s));
pn = await notes(POSTER);
check("A8 the poster is told it is on hold", pn.length === 1 && /on hold/.test(pn[0].message) && pn[0].link === `/posts?job=${J(8)}`, JSON.stringify(pn));

// A8b: Helpr banned after Done (awaiting approval) -> held, not auto-released.
await reset();
await seedJob(J(18), { status: "in_progress", helper: HELPR, confirmed: true, done: true, hoursOut: -3 });
await ban(HELPR);
s = await job(J(18));
check("A8b banned Helpr who marked Done -> disputed + ESCALATED (auto-release never selects it)", s.status === "disputed" && s.dispute_status === "escalated", JSON.stringify(s));

// A9/A10: the banned Helpr's pending applications and a pending offer to them.
await reset();
await seedJob(J(9), { status: "open", customer: OTHER });
await seedJob(J(10), { status: "open", customer: OTHER, offeredTo: HELPR, offerStatus: "pending" });
await seedApp(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(9)}', '${HELPR}', 'pending')`);
r = await ban(HELPR);
const a9 = await one(`SELECT status, closed_reason FROM public.applications WHERE job_id='${J(9)}'`);
check("A9 banned Helpr's pending application -> rejected, party_blocked (silent)", a9.status === "rejected" && a9.closed_reason === "party_blocked", JSON.stringify(a9));
check("A9 the job itself stays open for everyone else", (await job(J(9))).status === "open");
s = await job(J(10));
check("A10 a pending offer to the banned Helpr -> declined, job open", s.direct_offer_status === "declined" && s.status === "open", JSON.stringify(s));
const on = await notes(OTHER);
check("A10 the poster is told the offer closed", on.some((n) => n.job_id === J(10) && /offer is closed/.test(n.message)), JSON.stringify(on));
check("A9 the banned Helpr gets no notices", (await notes(HELPR)).length === 0);

// A11: an existing poster-filed dispute becomes escalated when the Helpr is banned.
await reset();
await seedJob(J(11), { status: "disputed", helper: HELPR, confirmed: true, disputeStatus: "open" });
await ban(HELPR);
s = await job(J(11));
check("A11 open dispute -> escalated (the 72h timeout can no longer pay the banned Helpr)", s.status === "disputed" && s.dispute_status === "escalated", JSON.stringify(s));

// A12: money already moved on a live job -> nothing changes, admins + other party told.
await reset();
await seedJob(J(12), { status: "accepted", helper: HELPR, confirmed: true, pay: "refunded" });
await ban(POSTER);
s = await job(J(12));
check("A12 live job whose money was already refunded -> unchanged", s.status === "accepted" && s.payment_status === "refunded", JSON.stringify(s));
check("A12 admins told", (await adminNotes()).some((n) => n.job_id === J(12)));
check("A12 the Helpr is told a person will review it", (await notes(HELPR)).some((n) => /review/.test(n.message)));

// A13: banned Helpr's finished job with a payout still pending -> unchanged, admins told.
await reset();
await seedJob(J(13), { status: "completed", helper: HELPR, confirmed: true, pay: "payout_pending", done: true });
await ban(HELPR);
s = await job(J(13));
check("A13 completed + payout_pending -> unchanged, admins told", s.status === "completed" && s.payment_status === "payout_pending" && (await adminNotes()).some((n) => n.job_id === J(13)), JSON.stringify(s));

// A14: series and visits are the recurring lane's.
await reset();
await seedJob(J(14), { status: "open", recurring: true });
await seedJob(J(15), { status: "accepted", helper: HELPR, confirmed: true, parent: J(14) });
await ban(POSTER);
check("A14 a series parent and its visit are untouched", (await job(J(14))).status === "open" && (await job(J(15))).status === "accepted");

// A15: crew -> admin review, unchanged.
await reset();
await seedJob(J(16), { status: "open", crew: true });
await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id, share_cents, slot_no) VALUES ('${J(16)}', '${HELPR}', 10000, 0)`);
await ban(HELPR);
check("A15 a crew job the banned Helpr is on -> unchanged, admins told", (await job(J(16))).status === "open" && (await adminNotes()).some((n) => n.job_id === J(16)));

// A16: idempotent — a second run changes nothing and sends nothing.
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
await seedJob(J(5), { status: "in_progress", helper: HELPR, confirmed: true, arrived: true, customer: POSTER, hoursOut: -1 });
await ban(POSTER);
const n1 = (await one(`SELECT count(*)::int AS n FROM public.notifications`)).n;
const again = await as("service_role", null, `SELECT public.settle_one_off_jobs_for_banned_account('${POSTER}') AS v`);
const n2 = (await one(`SELECT count(*)::int AS n FROM public.notifications`)).n;
check("A16 a re-run settles nothing more and notifies nobody", again.ok && again.rows[0].v.settled.length === 0 && n1 === n2, JSON.stringify(again.rows?.[0]?.v));

// A17: a temporary ban does not fire (the owner rule: temporary pauses).
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
await ban(POSTER, "temp_banned");
check("A17 temp_banned leaves the job live", (await job(J(2))).status === "accepted");

// A18: a job the chain refuses never fails the ban; the other jobs still settle.
await reset();
await seedJob(J(2), { status: "accepted", helper: HELPR, confirmed: true, hoursOut: 10 });
await seedJob(J(3), { status: "open" });
await db.exec(`CREATE FUNCTION public.q327_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.id = '${J(2)}' THEN RAISE EXCEPTION 'planted refusal'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER zz_q327_refuse BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.q327_refuse();`);
r = await ban(POSTER);
check("A18 the ban still lands when one job cannot be settled", r.ok && (await one(`SELECT ban_status FROM public.profiles WHERE user_id='${POSTER}'`)).ban_status === "permanently_banned", r.error);
check("A18 the refused job is left as it was", (await job(J(2))).status === "accepted");
check("A18 the other job still settles", (await job(J(3))).status === "cancelled");
check("A18 admins are told which job failed and why", (await adminNotes()).some((n) => n.job_id === J(2) && /planted refusal/.test(n.message)));
check("A18 no sanctioned hatch is left on after the failure", (await one(`SELECT coalesce(current_setting('app.sanctioned_cancel', true), 'off') AS v`)).v !== "on");
await db.exec(`DROP TRIGGER zz_q327_refuse ON public.jobs; DROP FUNCTION public.q327_refuse();`);

// ── CLASS SWEEP: every status x payment_status x seat x started ────────────
console.log("\n── class sweep ──────────────────────────────────────────────────");
const STATUSES = (await all(`SELECT unnest(enum_range(NULL::public.job_status))::text AS s`)).map((x) => x.s);
// The inventory is the app's own: jobs_payment_status_check as the migrations
// leave it (the NEWEST ADD CONSTRAINT, comments blanked), plus NULL (never paid).
const PAY_CHECK = BEFORE_FILES.flatMap((f) =>
  [...blankSqlComments(mig(f)).matchAll(/ADD\s+CONSTRAINT\s+jobs_payment_status_check\s+CHECK\s*\(([\s\S]*?)\)\s*\)\s*;/gi)].map((m) => m[1])).at(-1);
if (!PAY_CHECK) throw new Error("jobs_payment_status_check not found in the migrations");
const PAYS = [null, ...[...PAY_CHECK.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])];
const LIVE_STATUSES = new Set(["open", "pending_approval", "accepted", "in_progress", "revision_requested"]);
let combos = 0;
const bad = [];
const tally = {};
for (const st of STATUSES) for (const pay of PAYS) for (const seat of ["poster", "helpr"]) for (const started of [false, true]) {
  combos++;
  await reset();
  const id = J(100);
  await seedJob(id, {
    status: st, pay, helper: seat === "helpr" || st !== "open" ? HELPR : null,
    confirmed: true, arrived: started, disputeStatus: st === "disputed" ? "open" : null, hoursOut: 10,
  });
  const banned = seat === "poster" ? POSTER : HELPR;
  if (seat === "helpr" && st === "open") await db.exec(`SET session_replication_role = replica; UPDATE public.jobs SET helper_id='${HELPR}' WHERE id='${id}'; SET session_replication_role = origin;`);
  const res = await as("service_role", null, `UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = '${banned}' RETURNING user_id`);
  const after = await job(id);
  const out = await as("service_role", null, `SELECT public.ban_settlement_action('${seat}', '${st}', ${pay ? `'${pay}'` : "NULL"}, ${started || st === "revision_requested"}, false, false) AS a`);
  const action = out.rows?.[0]?.a;
  tally[action] = (tally[action] ?? 0) + 1;
  const admins = (await adminNotes()).filter((n) => n.job_id === id);
  const failed = admins.some((n) => /settling it failed/.test(n.message));
  const stillLive = LIVE_STATUSES.has(after.status) && (after.helper_id === banned || seat === "poster");
  const heldOrNamed = (after.status === "disputed" && after.dispute_status === "escalated") || admins.length > 0;
  const why = [];
  if (!res.ok) why.push(`ban failed: ${res.error}`);
  if (!action || action === "unhandled") why.push(`action ${action}`);
  if (failed) why.push(`settlement failed: ${admins.map((n) => n.message).join(" | ")}`);
  if (stillLive && !heldOrNamed) why.push(`left live with the banned party and nobody told (${after.status})`);
  if (st === "disputed" && after.dispute_status !== "escalated") why.push("dispute not escalated");
  if (why.length) bad.push(`${seat}/${st}/${pay ?? "NULL"}/${started ? "started" : "not started"}: ${why.join("; ")}`);
  await unbanAll();
}
console.log(`  ${combos} combinations (${STATUSES.length} statuses x ${PAYS.length} payment states x 2 seats x 2)`);
console.log(`  actions: ${JSON.stringify(tally)}`);
for (const b of bad) console.log(`    ${b}`);
check("SWEEP every combination is handled: none unhandled, none failed, none left live unseen", bad.length === 0, `${bad.length} bad`);
check(`SWEEP the inventory is real (${STATUSES.length} statuses, ${PAYS.length} payment states incl. NULL)`,
  STATUSES.length >= 8 && PAYS.length >= 11 && combos === STATUSES.length * PAYS.length * 4);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
