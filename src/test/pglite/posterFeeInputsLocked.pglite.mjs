#!/usr/bin/env node
/**
 * PGlite proof for 20260925231810_poster_cannot_move_fee_inputs (docs/OPEN.md Q423).
 *
 *   node src/test/pglite/posterFeeInputsLocked.pglite.mjs              # before (RED) + after, 3x apply
 *   NEW_MIGRATION=skip node src/test/pglite/posterFeeInputsLocked.pglite.mjs   # before only
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * THE BEFORE STATE is what prod would hold without this migration, built from
 * the migrations, not hand-listed:
 *   - public.jobs as read from prod (scripts/probes/fixtures/dispute-table-door
 *     .live.sql, 2026-09-14) plus every `ALTER TABLE public.jobs ADD COLUMN`
 *     in a later migration;
 *   - EVERY BEFORE trigger on public.jobs that the migrations leave standing
 *     (found by scanning CREATE/DROP TRIGGER), with the function it runs at
 *     its NEWEST CREATE text before this migration;
 *   - poster_cancel_job and the functions it prices with, newest text.
 * Roles are real: `authenticated` + a JWT sub is PostgREST with a user token;
 * SECURITY DEFINER functions are owned by the superuser, as on prod.
 * Stubs (not under test): is_caller_banned, are_users_blocked,
 * log_notification, apply_job_denial_consequence, apply_consequence_ladder
 * (records a user_violations row so the strike is observable),
 * dispute_evidence_url_ok, and any trigger helper that only reads unrelated
 * tables (listed in STUBS below).
 *
 * RED-BEFORE (Q423):
 *   R1  the poster clears helper_confirmed_at on their own funded, confirmed
 *       booking 10h before the start (PostgREST PATCH), then poster_cancel_job
 *       charges $0 and records no strike; without the clear it charges 25%
 *       ($50 of $200) and strikes.
 *   R2  the poster clears helper_dayof_confirmed_at.
 *   R3  the poster moves date_needed three days out on the confirmed booking,
 *       then cancels: $0 instead of 25%.
 *   R4  the poster moves start_time past the 24h line: $0 instead of 25%.
 *   R5  the poster forges helper_confirmed_at on a hired-but-unconfirmed job.
 *   R6  a crew (no jobs.helper_id, one member hired): the poster moves the
 *       date out, then cancels for $0 instead of the member's 25% share.
 * AFTER: A1.. below (each red write refused and the fee unchanged; every
 * legitimate writer still lands).
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname;
const DIR = `${ROOT}supabase/migrations/`;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20260925231810_poster_cannot_move_fee_inputs.sql";
const MIGRATION = process.env.NEW_MIGRATION_FILE ? readFileSync(process.env.NEW_MIGRATION_FILE, "utf8") : mig(THIS);
const MODE = process.env.NEW_MIGRATION ?? "";
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();

// ── the jobs table: live columns + every later ADD COLUMN ────────────────────
const LIVE = readFileSync(`${ROOT}scripts/probes/fixtures/dispute-table-door.live.sql`, "utf8");
const JOBS_DDL = /^CREATE TABLE public\.jobs \([\s\S]*?^\);/m.exec(LIVE)[0];
const LIVE_READ = "20260914"; // the fixture's read date
const LATER_COLUMNS = BEFORE_FILES.filter((f) => f > LIVE_READ)
  .flatMap((f) => [...mig(f).matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?public\.jobs\s+([\s\S]*?);/gi)].map((m) => m[1]))
  .flatMap((body) => [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([\w\[\]]+)/gi)].map((m) => `ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]};`))
  .join("\n");

// ── every standing BEFORE trigger on jobs, from the migrations ───────────────
const triggers = {};
for (const f of BEFORE_FILES) {
  const s = mig(f);
  const re = /(CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+([\s\S]*?);)|(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?)/gi;
  for (const m of s.matchAll(re)) {
    if (m[1]) {
      if (/\bON\s+(?:public\.)?"?(\w+)"?/i.exec(m[3])?.[1] !== "jobs") continue;
      triggers[m[2]] = { sql: m[1], fn: /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/i.exec(m[3])[1], before: /^\s*BEFORE\b/i.test(m[3]) };
    } else if (m[6] === "jobs") delete triggers[m[5]];
  }
}
const BEFORE_TRIGGERS = Object.entries(triggers).filter(([, t]) => t.before).sort(([a], [b]) => (a < b ? -1 : 1));

// Functions the chain and the cancel path run, newest text. Helpers the trigger
// bodies call are listed by hand (they are not triggers); a missing one fails loudly.
const HELPERS = [
  "is_server_context", "has_role", "job_payment_is_funded", "helper_award_block_reason",
  "job_expires_at_for_schedule", "poster_cancel_job", "job_hours_until_start", "cancellation_fee_percent",
  "is_late_cancellation", "apply_cancellation_violation_consequence", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents", "helper_cancel_booking",
];
// Trigger functions replaced by a pass-through: they fire only on columns this
// proof never writes, or read tables that are not under test.
const STUBS = new Set(["reject_contact_leak_in_job", "validate_job_budget", "enforce_ban_gate", "enforce_jobs_dispute_evidence_append_only"]);
const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
function cutFunction(sql, name) {
  const m = [...sql.matchAll(defRe(name))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}
const newestText = (fn) => {
  const file = BEFORE_FILES.filter((f) => defRe(fn).test(mig(f))).at(-1);
  if (!file) throw new Error(`${fn}: no definition before ${THIS}`);
  return cutFunction(mig(file), fn);
};
const chainFns = [...new Set(BEFORE_TRIGGERS.map(([, t]) => t.fn))];
const FUNCTIONS = [
  ...HELPERS.map(newestText),
  ...chainFns.map((fn) =>
    STUBS.has(fn)
      ? `CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`
      : newestText(fn)),
].join("\n\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "99999999-9999-9999-9999-999999999999";
const HELPR = "11111111-1111-1111-1111-111111111111";
const ADMIN = "55555555-5555-5555-5555-555555555555";
const JOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean, stripe_identity_verified boolean,
  idv_status text, is_seed boolean DEFAULT false, full_name text, email_verified boolean DEFAULT true, ban_status text
);
${JOBS_DDL}
${LATER_COLUMNS}
ALTER TABLE public.jobs ALTER COLUMN status SET DEFAULT 'open';
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text DEFAULT 'accepted', joined_at timestamptz DEFAULT now(),
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, share_cents integer, slot_no integer
);
CREATE TABLE public.crew_cancellation_fee_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, committed boolean,
  share_basis_cents integer, fee_percent integer, share_amount numeric, UNIQUE (job_id, helper_id)
);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid
);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
-- The live poster/helper UPDATE policies on jobs (20260311000404, 20260312010219):
-- whole-row, which is why the column locks are triggers.
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs FOR UPDATE USING (auth.uid() = helper_id);

-- Stubs (not under test).
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
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

${BEFORE_TRIGGERS.map(([, t]) => t.sql).join("\n")}
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];

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
/** A PostgREST PATCH with .select("id"): landed iff one row comes back. */
const patch = (uid, set) => as("authenticated", uid, `UPDATE public.jobs SET ${set} WHERE id = '${JOB}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;

/**
 * A funded, hired single booking starting `hoursOut` from now (America/Chicago),
 * $200 budget. confirmed: the Helpr accepted it (helper_confirmed_at stamped).
 */
async function seed({ hoursOut = 10, confirmed = true, dayof = true } = {}) {
  await db.exec(`
    DELETE FROM public.user_violations; DELETE FROM public.notifications; DELETE FROM public.applications;
    DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, date_needed, start_time,
                             payment_status, stripe_session_id, stripe_payment_intent_id, helper_fee_percent,
                             helper_confirmed_at, helper_dayof_confirmed_at, is_group_job, helpers_needed)
    VALUES ('${JOB}', '${POSTER}', '${HELPR}', 'Haul a couch', 'accepted', 200,
            (now() AT TIME ZONE 'America/Chicago' + interval '${hoursOut} hours')::date,
            date_trunc('minute', (now() AT TIME ZONE 'America/Chicago' + interval '${hoursOut} hours'))::time,
            'escrow', 'cs_test_q423', 'pi_test_q423', 10,
            ${confirmed ? "now() - interval '2 days'" : "NULL"}, ${confirmed && dayof ? "now() - interval '1 hour'" : "NULL"},
            false, 1);
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${JOB}', '${HELPR}', 'accepted');`);
}
const cancel = async () => {
  const r = await as("authenticated", POSTER, `SELECT public.poster_cancel_job('${JOB}', 'plans changed') AS v`);
  const strikes = (await one(`SELECT count(*)::int AS n FROM public.user_violations WHERE user_id='${POSTER}'`)).n;
  const row = await one(`SELECT cancellation_fee::text AS fee, late_cancellation AS late FROM public.jobs WHERE id='${JOB}'`);
  return { ok: r.ok, error: r.error, fee: Number(row.fee ?? 0), late: row.late, strikes };
};
const stamps = () =>
  one(`SELECT helper_confirmed_at IS NOT NULL AS c, helper_dayof_confirmed_at IS NOT NULL AS d, date_needed::text AS dn, start_time::text AS st FROM public.jobs WHERE id='${JOB}'`);

// The attacks, each a PostgREST PATCH by the poster followed by their cancel.
const ATTACKS = [
  { id: "R1", label: "clears helper_confirmed_at, then cancels 10h out", set: "helper_confirmed_at = NULL" },
  { id: "R3", label: "moves date_needed 3 days out, then cancels", set: "date_needed = date_needed + 3" },
  { id: "R4", label: "moves start_time past the 24h line, then cancels", set: "start_time = start_time + interval '23 hours', date_needed = date_needed + CASE WHEN start_time + interval '23 hours' < start_time THEN 1 ELSE 0 END" },
];

async function runAttacks(phase) {
  await seed();
  const honest = await cancel();
  console.log(`  honest cancel 10h out: ok=${honest.ok} fee=$${honest.fee} late=${honest.late} strikes=${honest.strikes}${honest.error ? ` err=${honest.error}` : ""}`);
  check(`${phase} baseline: an honest cancel 10h out charges 25% of $200 and strikes`, honest.ok && honest.fee === 50 && honest.strikes === 1, JSON.stringify(honest));

  const out = {};
  for (const a of ATTACKS) {
    await seed();
    const w = await patch(POSTER, a.set);
    const c = await cancel();
    out[a.id] = { write: landed(w), writeErr: w.error, ...c };
    console.log(`  ${a.id} poster ${a.label}: PATCH ${landed(w) ? "LANDED" : `refused (${w.error})`} -> fee=$${c.fee} late=${c.late} strikes=${c.strikes}`);
  }
  await seed();
  const d = await patch(POSTER, "helper_dayof_confirmed_at = NULL");
  out.R2 = { write: landed(d), writeErr: d.error };
  console.log(`  R2 poster clears helper_dayof_confirmed_at: ${landed(d) ? "LANDED" : `refused (${d.error})`}`);
  await seed({ confirmed: false });
  const f = await patch(POSTER, "helper_confirmed_at = now()");
  out.R5 = { write: landed(f), writeErr: f.error };
  console.log(`  R5 poster forges helper_confirmed_at on an unconfirmed hire: ${landed(f) ? "LANDED" : `refused (${f.error})`}`);
  // A crew: no jobs.helper_id, one hired member on the roster.
  await seedCrew();
  const honestCrew = await cancel();
  await seedCrew();
  const cw = await patch(POSTER, "date_needed = date_needed + 3");
  const cc = await cancel();
  out.R6 = { write: landed(cw), writeErr: cw.error, honestFee: honestCrew.fee, ...cc };
  console.log(`  R6 crew: honest cancel fee=$${honestCrew.fee}; poster moves date_needed 3 days out: ${landed(cw) ? "LANDED" : `refused (${cw.error})`} -> fee=$${cc.fee}`);
  return out;
}

/** A funded crew of 2 slots ($200), one member hired (share 10000 cents), 10h out. */
async function seedCrew() {
  await db.exec(`
    DELETE FROM public.user_violations; DELETE FROM public.notifications; DELETE FROM public.applications;
    DELETE FROM public.crew_cancellation_fee_shares; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, date_needed, start_time,
                             payment_status, stripe_session_id, helper_fee_percent, is_group_job, helpers_needed)
    VALUES ('${JOB}', '${POSTER}', NULL, 'Move a piano', 'open', 200,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date,
            date_trunc('minute', (now() AT TIME ZONE 'America/Chicago' + interval '10 hours'))::time,
            'escrow', 'cs_test_crew', 10, true, 2);
    INSERT INTO public.group_job_helpers (job_id, helper_id, share_cents, slot_no) VALUES ('${JOB}', '${HELPR}', 10000, 0);`);
}

// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
await db.exec(`INSERT INTO auth.users (id) VALUES ('${POSTER}'), ('${HELPR}'), ('${ADMIN}');
  INSERT INTO public.profiles (user_id, is_seed, full_name) VALUES ('${POSTER}', true, 'Poster'), ('${HELPR}', true, 'Helpr'), ('${ADMIN}', true, 'Admin');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);
console.log(`before state: ${BEFORE_TRIGGERS.length} BEFORE triggers on jobs (${STUBS.size} stubbed), ${HELPERS.length} helpers, newest text before ${THIS}`);
console.log(`  triggers: ${BEFORE_TRIGGERS.map(([n]) => n).join(", ")}`);

console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
const before = await runAttacks("before");
check("R1 poster CAN clear helper_confirmed_at and the late cancel then costs $0 and no strike",
  before.R1.write && before.R1.fee === 0 && before.R1.strikes === 0, JSON.stringify(before.R1));
check("R2 poster CAN clear helper_dayof_confirmed_at", before.R2.write, JSON.stringify(before.R2));
check("R3 poster CAN move date_needed out on a confirmed booking and cancel for $0", before.R3.write && before.R3.fee === 0, JSON.stringify(before.R3));
check("R4 poster CAN move start_time past 24h on a confirmed booking and cancel for $0", before.R4.write && before.R4.fee === 0, JSON.stringify(before.R4));
check("R5 poster CAN forge helper_confirmed_at", before.R5.write, JSON.stringify(before.R5));
check("R6 poster CAN move a crew's date out once a member is hired and cancel for $0", before.R6.write && before.R6.honestFee === 25 && before.R6.fee === 0, JSON.stringify(before.R6));

if (MODE === "skip") {
  console.log(failures ? `${failures} FAILED` : "BEFORE reproduced (all R* observed)");
  process.exit(failures ? 1 : 0);
}

for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(`\n── AFTER (${THIS} applied 3x) ─────────────────────────────`);
const after = await runAttacks("after");
for (const id of ["R1", "R3", "R4"]) {
  check(`A-${id} the poster's PATCH is refused and the cancel still charges $50 and strikes`,
    !after[id].write && after[id].fee === 50 && after[id].strikes === 1, JSON.stringify(after[id]));
}
check("A-R2 clearing helper_dayof_confirmed_at is refused", !after.R2.write, JSON.stringify(after.R2));
check("A-R5 forging helper_confirmed_at is refused", !after.R5.write, JSON.stringify(after.R5));
check("A-R6 a crew's date is locked once a member is hired; the cancel still charges the member's $25", !after.R6.write && after.R6.fee === 25, JSON.stringify(after.R6));

// ── legitimate writers keep working ────────────────────────────────────────
await seed({ confirmed: false });
let r = await patch(HELPR, "helper_confirmed_at = now(), response_deadline = NULL");
check("L1 the Helpr's own confirm (useOfferHandlers PATCH) lands", landed(r), r.error ?? "");
r = await patch(HELPR, "helper_dayof_confirmed_at = now()");
check("L2 the Helpr's day-of confirm (JobConfirmation PATCH) lands", landed(r), r.error ?? "");
r = await patch(POSTER, "poster_confirmed_at = now()");
check("L3 the poster's own day-of confirm (poster_confirmed_at) lands", landed(r), r.error ?? "");
r = await patch(POSTER, "title = 'Haul a couch and a chair', description = 'two items'");
check("L4 the poster's unrelated edit on a booked job lands", landed(r), r.error ?? "");
await seed();
r = await as("authenticated", HELPR, `SELECT public.helper_cancel_booking('${JOB}') AS v`);
const cleared = await stamps();
check("L5 helper_cancel_booking (the Helpr, definer) still clears both stamps", r.ok && !cleared.c && !cleared.d, r.error ?? JSON.stringify(cleared));
// An open job with no Helpr: the poster may still reschedule it (EditJobDialog,
// "Give it a new date"), funded or not.
await db.exec(`DELETE FROM public.jobs; INSERT INTO public.jobs (id, customer_id, title, status, budget, date_needed, start_time, payment_status, stripe_session_id, is_group_job, helpers_needed)
  VALUES ('${JOB}', '${POSTER}', 'Open', 'open', 200, (now() + interval '2 days')::date, '09:00', 'escrow', 'cs_open', false, 1);`);
r = await patch(POSTER, "date_needed = date_needed + 1, start_time = '10:30'");
check("L6 the poster reschedules a funded job nobody is hired on", landed(r), r.error ?? "");
await seed();
r = await as("service_role", null, `UPDATE public.jobs SET helper_confirmed_at = NULL, date_needed = date_needed + 1 WHERE id='${JOB}' RETURNING id`);
check("L7 a server context (service role) may still write the stamps and the schedule", landed(r), r.error ?? "");
await seed();
r = await patch(ADMIN, "date_needed = date_needed + 1");
check("L8 an admin who is not the poster is not judged by the poster lock", r.ok, r.error ?? "");

// ── the function itself ────────────────────────────────────────────────────
const fn = await one(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.enforce_poster_jobs_money_lock()')`);
check("F1 the lock is still SECURITY DEFINER (reads the roster as the owner)", fn?.prosecdef === true, JSON.stringify(fn));
check("F2 no client role may EXECUTE the trigger function", fn && !/(^|[{,])(anon|authenticated)?=X/.test(fn.acl ?? "{=X}"), fn?.acl);
const t = await one(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_poster_jobs_money_lock' AND NOT tgisinternal`);
check("F3 exactly one trg_poster_jobs_money_lock after 3 applies", t.n === 1, `n=${t.n}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
