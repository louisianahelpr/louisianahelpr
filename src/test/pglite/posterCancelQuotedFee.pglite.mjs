#!/usr/bin/env node
/**
 * PGlite proof for 20261021130723_poster_cancel_checks_quoted_fee (boards
 * 66/172 slice 2): poster_cancel_job takes p_expected_fee_cents, the fee the
 * cancel dialog's server quote showed, and refuses with quote_changed (HINT:
 * the new fee) before writing anything when the fee it records is not that.
 *
 *   npx tsx src/test/pglite/posterCancelQuotedFee.pglite.mjs            # AFTER: applied 3x, every check PASS
 *   npx tsx src/test/pglite/posterCancelQuotedFee.pglite.mjs --before   # RED: without it, the Q-checks FAIL
 *   npx tsx src/test/pglite/posterCancelQuotedFee.pglite.mjs --no-check # RED: the new signature with the
 *                                                                          quote_changed block cut out (Q2, Q3 FAIL)
 *   ... --public-only   # RED: the migration revoking FROM PUBLIC alone (Q6 FAILS: anon keeps its default grant)
 *   CANCEL_FEE_MODULE=<path to an older _shared/cancellationFee.ts> ...     # RED for Q8 (the float formula)
 *
 * poster_cancel_job is loaded at its EFFECTIVE definition before this
 * migration (src/test/helpers/effectiveFunctionDefs.ts) with the real helpers
 * it prices with (job_hours_until_start, cancellation_fee_percent,
 * is_late_cancellation, crew_fee_pays_unconfirmed, crew_slot_share_cents,
 * helpr_flat_fee_cents). Stub (not under test):
 * apply_cancellation_violation_consequence.
 *
 *   Q1 a late solo cancel with the quoted fee ($25 of $100, 6 h out) goes through and records $25
 *   Q2 a stale "free" quote (0) on the same kind of job is refused: quote_changed, HINT names $25.00,
 *      the job is still booked, no Helpr notice, no strike
 *   Q3 a crew with a mismatched quote is refused and leaves NO fee-share rows (all rolled back)
 *   Q4 a free cancel (48 h out) quoted 0 goes through
 *   Q5 NULL (an older app build) and a two-argument call still cancel, unchecked
 *   Q6 the old (uuid, text) signature is gone (no PGRST203 ambiguity); the new one is
 *      authenticated + service_role, not anon
 *   Q7 someone else's quote never helps: not_authorized comes first
 *   Q8 the TS fee the quote sends (computeCancellationFee) equals the SQL fee poster_cancel_job records,
 *      cent for cent, for every budget cent from $10.00 to $1,000.00 at 25% and 50% (lh-authz-rls review:
 *      the old float formula disagreed on 3,387 pairs, which would refuse those cancels forever)
 *
 * The prelude grants EXECUTE on new functions to anon by default, as prod does, so Q6 can fail.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const FEE_MODULE = process.env.CANCEL_FEE_MODULE ?? new URL("../../../supabase/functions/_shared/cancellationFee.ts", import.meta.url).pathname;
const { computeCancellationFee } = await import(FEE_MODULE);

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021130723_poster_cancel_checks_quoted_fee.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");
const NO_CHECK = process.argv.includes("--no-check");
const PUBLIC_ONLY = process.argv.includes("--public-only");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), H = U(2), M1 = U(3), M2 = U(4), X = U(9);
const LATE_OK = U(101), LATE_STALE = U(102), CREW = U(103), FREE = U(104), NULL_Q = U(105), TWO_ARG = U(106), OTHERS = U(107);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  budget numeric, helper_fee_percent numeric, helper_fee_flat_cents integer,
  date_needed date, start_time time, helper_confirmed_at timestamptz, helper_completed_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.crew_cancellation_fee_shares (job_id uuid, helper_id uuid, committed boolean, share_basis_cents bigint,
  fee_percent integer, share_amount numeric, PRIMARY KEY (job_id, helper_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
  type text, link text, job_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.strikes (job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- As prod: a function created in public is EXECUTE-able by anon until revoked by name.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION public.apply_cancellation_violation_consequence(p uuid) RETURNS jsonb LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.strikes VALUES (p); RETURN jsonb_build_object('action', 'warning', 'prior_count', 0); END $$;

${["job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents", "helpr_flat_fee_cents", "poster_cancel_job"].map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated, service_role;
`;

// Louisiana clock: SOON is a committed late cancel (25% at 6 h out), FAR is free (48 h out).
const at = (h) => `((now() + interval '${h} hours') AT TIME ZONE 'America/Chicago')`;
const job = (id, hours, over = {}) => {
  const cols = { id: `'${id}'`, customer_id: `'${P}'`, helper_id: `'${H}'`, helper_confirmed_at: "now()", title: `'Job ${id.slice(-3)}'`,
    budget: 100, status: `'accepted'`, helper_fee_percent: 10, date_needed: `${at(hours)}::date`, start_time: `${at(hours)}::time`, ...over };
  return `INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};

const db = new PGlite();
await db.exec(SCHEMA);
// --no-check: the same migration with its IF p_expected_fee_cents ... END IF; block cut out.
const CHECK_BLOCK = /  IF p_expected_fee_cents IS NOT NULL[\s\S]*?END IF;\n/;
if (NO_CHECK && !CHECK_BLOCK.test(MIGRATION)) throw new Error("--no-check: the quote_changed block was not found");
const APPLIED = NO_CHECK ? MIGRATION.replace(CHECK_BLOCK, "")
  : PUBLIC_ONLY ? MIGRATION.replace("(uuid, text, bigint) FROM PUBLIC, anon;", "(uuid, text, bigint) FROM PUBLIC;")
  : MIGRATION;
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(APPLIED);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (Q-checks must FAIL)"
  : NO_CHECK ? "-- NO-CHECK: migration applied 3x without its quote_changed block (Q2, Q3 must FAIL)" : "-- AFTER: migration applied 3x");

const asUser = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return { ok: true, rows: (await db.query(sql)).rows }; }
  catch (e) { return { ok: false, err: String(e.message), hint: e.hint ?? null }; }
  finally { await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`); }
};
const row = async (id) => (await db.query(`SELECT status::text s, cancellation_fee f, cancellation_fee_status fs FROM public.jobs WHERE id = '${id}'`)).rows[0];
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

await db.exec([job(LATE_OK, 6), job(LATE_STALE, 6), job(FREE, 48), job(NULL_Q, 6), job(TWO_ARG, 6), job(OTHERS, 6)].join("\n"));
await db.exec(job(CREW, 6, { helper_id: "NULL", helper_confirmed_at: "NULL", is_group_job: true, helpers_needed: 2 }));
await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES
  ('${CREW}', '${M1}', 1, 5000, now()), ('${CREW}', '${M2}', 2, 5000, now())`);

// Q1 the quoted fee goes through.
{
  const r = await asUser(P, `SELECT public.poster_cancel_job('${LATE_OK}', 'x', 2500) v`);
  const j = await row(LATE_OK);
  check("Q1 a late solo cancel with the quoted $25 goes through and records $25", r.ok && j.s === "cancelled" && Number(j.f) === 25 && j.fs === "pending",
    r.ok ? JSON.stringify(j) : r.err);
}
// Q2 a stale "free" quote is refused before any write.
{
  const notes = await count(`SELECT count(*) n FROM public.notifications WHERE link LIKE '%${LATE_STALE}%'`);
  const r = await asUser(P, `SELECT public.poster_cancel_job('${LATE_STALE}', 'x', 0) v`);
  const j = await row(LATE_STALE);
  check("Q2 a stale free quote is refused with quote_changed and the new fee", !r.ok && /quote_changed/.test(r.err) && /\$25\.00/.test(r.hint ?? ""),
    r.ok ? "went through" : `${r.err} / ${r.hint}`);
  check("Q2 the job is still booked: no status, fee, notice or strike written",
    j.s === "accepted" && j.f === null && (await count(`SELECT count(*) n FROM public.notifications WHERE link LIKE '%${LATE_STALE}%'`)) === notes
    && (await count(`SELECT count(*) n FROM public.strikes WHERE job_id = '${LATE_STALE}'`)) === 0, JSON.stringify(j));
}
// Q3 a crew with a mismatched quote: the share rows it inserted roll back with the refusal.
{
  const r = await asUser(P, `SELECT public.poster_cancel_job('${CREW}', 'x', 100) v`);
  const shares = await count(`SELECT count(*) n FROM public.crew_cancellation_fee_shares WHERE job_id = '${CREW}'`);
  check("Q3 a crew's mismatched quote is refused and leaves no fee-share rows", !r.ok && /quote_changed/.test(r.err) && shares === 0 && (await row(CREW)).s === "accepted",
    r.ok ? "went through" : `${r.err}; shares ${shares}`);
  const ok = await asUser(P, `SELECT public.poster_cancel_job('${CREW}', 'x', 2500) v`);
  check("Q3 the same crew with its real quote ($12.50 x 2) goes through", ok.ok && Number((await row(CREW)).f) === 25, ok.ok ? "" : ok.err);
}
// Q4 free cancel.
{
  const r = await asUser(P, `SELECT public.poster_cancel_job('${FREE}', NULL, 0) v`);
  check("Q4 a free cancel (48 h out) quoted 0 goes through", r.ok && (await row(FREE)).s === "cancelled" && Number((await row(FREE)).f) === 0, r.ok ? "" : r.err);
}
// Q5 unchecked callers keep working.
{
  const r1 = await asUser(P, `SELECT public.poster_cancel_job('${NULL_Q}', 'x', NULL) v`);
  const r2 = await asUser(P, `SELECT public.poster_cancel_job('${TWO_ARG}', 'x') v`);
  check("Q5 NULL (an older build) and a two-argument call still cancel, unchecked",
    r1.ok && r2.ok && (await row(NULL_Q)).s === "cancelled" && (await row(TWO_ARG)).s === "cancelled",
    [r1.err, r2.err].filter(Boolean).join(" | "));
}
// Q6 signatures and grants.
{
  const r = (await db.query(`SELECT to_regprocedure('public.poster_cancel_job(uuid,text)') IS NULL AS old_gone,
      to_regprocedure('public.poster_cancel_job(uuid,text,bigint)') IS NOT NULL AS new_there`)).rows[0];
  let grants = null;
  if (r.new_there) {
    grants = (await db.query(`SELECT array[has_function_privilege('anon', 'public.poster_cancel_job(uuid,text,bigint)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.poster_cancel_job(uuid,text,bigint)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.poster_cancel_job(uuid,text,bigint)', 'EXECUTE')] g`)).rows[0].g;
  }
  check("Q6 only (uuid, text, bigint) exists; authenticated + service_role, not anon",
    r.old_gone && r.new_there && JSON.stringify(grants) === "[false,true,true]", JSON.stringify({ ...r, grants }));
}
// Q7 a stranger with the right number is still refused as a stranger.
{
  const r = await asUser(X, `SELECT public.poster_cancel_job('${OTHERS}', 'x', 2500) v`);
  check("Q7 someone else's job: not_authorized, nothing written", !r.ok && /not_authorized/.test(r.err) && (await row(OTHERS)).s === "accepted", r.ok ? "went through" : r.err);
}

// Q8 TS quote fee == SQL recorded fee, every cent $10.00..$1,000.00, at 25% and 50%.
{
  const sql = (await db.query(`SELECT c, p, round((c / 100.0) * p)::int AS f
    FROM generate_series(1000, 100000) c, (VALUES (25), (50)) t(p)`)).rows;
  // A committed Helpr 6 h (25%) or 1 h (50%) before the start, Louisiana clock.
  const start = new Date("2026-10-21T21:00:00Z");
  const at = (h) => new Date(start.getTime() - h * 3600e3).toISOString();
  let bad = 0, first = "";
  for (const r of sql) {
    const ts = Math.round(computeCancellationFee({ budget: r.c / 100, date_needed: "2026-10-21", start_time: "16:00:00",
      cancelled_at: at(r.p === 25 ? 6 : 1), helper_id: H, helper_confirmed_at: "2026-10-20T00:00:00Z" }) * 100);
    if (ts !== r.f) { bad++; if (!first) first = `$${(r.c / 100).toFixed(2)} at ${r.p}%: ts ${ts} sql ${r.f}`; }
  }
  check(`Q8 the quote's TS fee equals the SQL fee for all ${sql.length} (cent budget, tier) pairs`, sql.length === 198002 && bad === 0, bad ? `${bad} differ; first ${first}` : "");
}

await db.close();
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
