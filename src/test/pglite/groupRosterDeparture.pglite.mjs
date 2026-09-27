#!/usr/bin/env node
/**
 * PGlite proof for 20260925140148_group_roster_departure.
 *
 *   node src/test/pglite/groupRosterDeparture.pglite.mjs
 *   node src/test/pglite/groupRosterDeparture.pglite.mjs --replay   # apply 3x
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * The BEFORE state is the migrations' newest text for every function in the
 * path, cut from the migration that last defines it (the probe refuses to run
 * if a later migration before this one restates any of them).
 * helper_cancel_booking and enforce_job_tracking_arrival_gate are also
 * md5-checked against pg_get_functiondef read from prod on 2026-09-25. Every
 * jobs UPDATE runs the real BEFORE UPDATE chain, in prod's trigger-name
 * order: award gate, cancellation-requires-rpc, status transition, helper
 * column whitelist, hire-columns lock, funding gate, poster money lock, field
 * escalation, arrival integrity. apply_job_denial_consequence and
 * is_caller_banned are stubs: the ladder is not what this proves.
 *
 * RED-BEFORE (D1..D3 as reproduced on prod in rolled-back DO blocks):
 *   R1  poster removes the lead from a staffing crew: jobs.helper_id still
 *       names the removed Helpr, whose application stays accepted.
 *   R2  crew member #2 cannot leave (helper_cancel_booking -> not_authorized).
 *   R3  the lead "leaves" a booked crew but keeps their roster row.
 *   R4  crew member #2, with their OWN before photo, is refused Working.
 * AFTER: A1..A24 below.
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
import { loadTreeHelperCancel } from "./treeFunction.mjs";

const mig = (f) =>
  readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const MIGRATION = mig("20260925140148_group_roster_departure.sql");

/**
 * Each function in the path, and the migration holding its newest definition
 * before 20260925140148 (src/test/helpers/effectiveFunctionDefs.ts agrees:
 * none of them carries a pg_get_functiondef rewrite before it).
 */
const NEWEST = {
  is_server_context: "20260915101102_null_uid_is_not_server.sql",
  has_role: "20260311000404_f8e7eb29-742a-409a-a3a3-a493232415e6.sql",
  job_payment_is_funded: "20260907060556_gate_helper_award_on_funded_escrow.sql",
  helper_award_block_reason: "20260908001056_identity_always_required.sql",
  enforce_helper_award_gate: "20260915101102_null_uid_is_not_server.sql",
  enforce_job_funded_before_award: "20260915101102_null_uid_is_not_server.sql",
  // 20260925052841 (recurring series end, docs/OPEN.md Q403) sorts before
  // this migration and restates these two with the app.series_end_rpc flag.
  enforce_helper_jobs_column_whitelist: "20260925052841_recurring_series_end.sql",
  enforce_hire_columns_rpc_only: "20260924044812_recurring_helper_rpc_only.sql",
  enforce_ban_gate: "20260925052841_recurring_series_end.sql",
  enforce_poster_jobs_money_lock: "20260915101102_null_uid_is_not_server.sql",
  prevent_job_field_escalation: "20260915101102_null_uid_is_not_server.sql",
  enforce_job_status_transition: "20260828020000_cancellation_requires_rpc.sql",
  enforce_jobs_arrival_integrity: "20260915074058_arrival_bad_pin_poster_confirm.sql",
  enforce_cancellation_requires_rpc: "20260915101102_null_uid_is_not_server.sql",
  helper_cancel_booking: "20260924220318_rename_tab_addresses.sql",
  enforce_job_tracking_arrival_gate: "20260919195158_before_photo_gates_working_step.sql",
};
const THIS = "20260925140148_group_roster_departure.sql";
const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
const defines = (sql, name) => defRe(name).test(sql);
/** The LAST CREATE FUNCTION public.<name>( statement in `sql`, through its closing dollar tag and `;`. */
function cutFunction(sql, name) {
  const m = [...sql.matchAll(defRe(name))].at(-1);
  if (!m) throw new Error(`${name} not defined in the given file`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}
const ALL = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname)
  .filter((f) => f.endsWith(".sql") && f < THIS)
  .sort();
for (const [fn, file] of Object.entries(NEWEST)) {
  const later = ALL.filter((f) => f > file && defines(mig(f), fn));
  if (later.length) {
    console.error(`${fn} is restated after ${file} (in ${later.join(", ")}): update NEWEST.`);
    process.exit(2);
  }
}
const BEFORE_FUNCTIONS = Object.entries(NEWEST)
  .map(([fn, file]) => cutFunction(mig(file), fn))
  .join("\n\n");
// md5(pg_get_functiondef(oid)) on prod fncmgoasalhdgfwzhsqa, 2026-09-25.
const PROD_MD5 = {
  helper_cancel_booking: "edc357c58aede8e6cd26d1424b4742eb",
  enforce_job_tracking_arrival_gate: "92d5e1ad8ecb2bb3d2a57b1b7d2af7ad",
};

const REPLAY = process.argv.includes("--replay");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "99999999-9999-9999-9999-999999999999";
const LEAD = "11111111-1111-1111-1111-111111111111";
const M2 = "22222222-2222-2222-2222-222222222222";
const M3 = "44444444-4444-4444-4444-444444444444";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";
const GJOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SJOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, stripe_account_id text, stripe_payouts_enabled boolean,
  stripe_identity_verified boolean, idv_status text, is_seed boolean DEFAULT false
);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status job_status NOT NULL DEFAULT 'open',
  is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  date_needed date, start_time time,
  response_deadline timestamptz, offered_to_helper_id uuid, recurring_helper_id uuid,
  stripe_session_id text, stripe_payment_intent_id text, budget numeric,
  helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_working_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz,
  recurrence_days text[], parent_job_id uuid,
  require_photo_proof boolean DEFAULT true, proof_before_urls text[], proof_after_urls text[],
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz,
  start_reminder_sent_at timestamptz,
  helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  poster_completed_at timestamptz, helper_completed_at timestamptz,
  payment_status text
);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(),
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz,
  helper_completed_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  UNIQUE (job_id, helper_id)
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text
);
CREATE TABLE public.job_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, title text, message text, type text, link text, job_id uuid
);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- The roster's live policies (the two this path uses).
ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view" ON public.group_job_helpers FOR SELECT USING (
  (SELECT auth.uid()) IN (SELECT jobs.customer_id FROM public.jobs WHERE jobs.id = group_job_helpers.job_id)
  OR (SELECT auth.uid()) = helper_id);
CREATE POLICY "remove while staffing" ON public.group_job_helpers FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = group_job_helpers.job_id
          AND j.customer_id = (SELECT auth.uid()) AND j.status = 'open'::job_status));

-- Stubs (not under test).
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action','record') $$;

-- ── the migrations' newest text for every function in the path ─────────────
${BEFORE_FUNCTIONS}

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;

-- prod's BEFORE UPDATE chain on jobs (names as on prod: they fire in name order).
CREATE TRIGGER jobs_award_gate BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_award_gate();
CREATE TRIGGER trg_cancellation_requires_rpc BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cancellation_requires_rpc();
CREATE TRIGGER trg_enforce_job_status_transition BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_status_transition();
CREATE TRIGGER trg_helper_jobs_column_whitelist BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_jobs_column_whitelist();
CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();
CREATE TRIGGER trg_job_funded_before_award BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_funded_before_award();
CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_jobs_money_lock();
CREATE TRIGGER trg_prevent_job_field_escalation BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_job_field_escalation();
CREATE TRIGGER zz_jobs_arrival_integrity BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_arrival_integrity();
CREATE TRIGGER trg_hire_columns_rpc_only BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();
CREATE TRIGGER trg_ban_gate_group_job_helpers_delete BEFORE DELETE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();

CREATE TRIGGER trg_job_tracking_arrival_gate BEFORE INSERT OR UPDATE ON public.job_tracking
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_tracking_arrival_gate();
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];

async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, res: await db.exec(sql) };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const asUser = (uid, sql) => as("authenticated", uid, sql);

/**
 * A crew of `members` (in hire order, the first is the lead) on GJOB, plus a
 * single-helper job SJOB booked to LEAD. Every member's application is accepted.
 */
async function seed({ status = "open", funded = true, needed = 3, members = [LEAD, M2], start = "+5 days", slotPhoto = {}, jobPhoto = false, blocked = [], confirmed = { [LEAD]: true }, noSlot = [], reminders = true } = {}) {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.job_tracking; DELETE FROM public.applications;
    DELETE FROM public.group_job_helpers; DELETE FROM public.jobs; DELETE FROM public.profiles;
    INSERT INTO public.profiles (user_id, is_seed) VALUES
      ('${LEAD}', true), ('${M2}', true), ('${M3}', true), ('${OUTSIDER}', true), ('${POSTER}', true);
    ${blocked.map((u) => `UPDATE public.profiles SET is_seed = false WHERE user_id = '${u}';`).join("\n")}
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, is_group_job, helpers_needed,
                             date_needed, start_time, payment_status, stripe_session_id, proof_before_urls,
                             helper_confirmed_at, helper_dayof_confirmed_at, response_deadline,
                             dayof_confirm_reminder_sent_at, dayof_unanswered_poster_alert_sent_at, start_reminder_sent_at)
    VALUES ('${GJOB}', '${POSTER}', ${members.length ? `'${members[0]}'` : "NULL"}, 'Move a piano', '${status}', true, ${needed},
            (now() + interval '${start}')::date, '09:00', ${funded ? "'escrow'" : "'abandoned'"}, 'cs_test_1',
            ${jobPhoto ? "ARRAY['job/before.jpg']" : "NULL"},
            ${confirmed[members[0]] ? "'2026-09-20T12:00:00Z'" : "NULL"}, ${confirmed[members[0]] ? "'2026-09-20T12:00:00Z'" : "NULL"},
            ${reminders ? "now() + interval '1 day', now(), now(), now()" : 'NULL, NULL, NULL, NULL'}),
           ('${SJOB}', '${POSTER}', '${LEAD}', 'Mow a lawn', 'accepted', false, 1,
            (now() + interval '5 days')::date, '09:00', 'escrow', 'cs_test_2', NULL, now(), NULL, NULL, NULL, NULL, NULL);
    ${members
      .map(
        (m, i) => `${noSlot.includes(m) ? "" : `INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, helper_confirmed_at, helper_dayof_confirmed_at, helper_arrived_at, poster_confirmed_arrival_at, proof_before_urls)
         VALUES ('${GJOB}', '${m}', now() - interval '${10 - i} minutes',
                 ${confirmed[m] ? `'2026-09-2${i + 1}T12:00:00Z'` : "NULL"}, ${confirmed[m] ? `'2026-09-2${i + 1}T13:00:00Z'` : "NULL"},
                 now(), now(), ${slotPhoto[m] ? "ARRAY['slot/before.jpg']" : "NULL"});`}
         INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${GJOB}', '${m}', 'accepted');`,
      )
      .join("\n")}
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${SJOB}', '${LEAD}', 'accepted');
  `);
}
const job = (id = GJOB) =>
  one(`SELECT helper_id, status::text AS status, helper_confirmed_at, helper_dayof_confirmed_at, response_deadline,
              dayof_confirm_reminder_sent_at, dayof_unanswered_poster_alert_sent_at, start_reminder_sent_at
         FROM public.jobs WHERE id='${id}'`);
/** Every per-lead stamp the trigger resets is NULL. */
const lanesClear = (j) =>
  j.response_deadline === null && j.dayof_confirm_reminder_sent_at === null &&
  j.dayof_unanswered_poster_alert_sent_at === null && j.start_reminder_sent_at === null;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const roster = async () =>
  (await db.query(`SELECT helper_id FROM public.group_job_helpers WHERE job_id='${GJOB}' ORDER BY joined_at`)).rows.map((r) => r.helper_id);
const appStatus = async (h, j = GJOB) =>
  (await one(`SELECT status FROM public.applications WHERE job_id='${j}' AND helper_id='${h}'`))?.status;
const removeAsPoster = (h) =>
  asUser(POSTER, `DELETE FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${h}';`);
const leave = (h, j = GJOB) => asUser(h, `SELECT public.helper_cancel_booking('${j}');`);
const working = (h) =>
  asUser(h, `INSERT INTO public.job_tracking (job_id, helper_id, status) VALUES ('${GJOB}', '${h}', 'working');`);

// ════════════════════════════════════════════════════════════════════════════
await db.exec(SETUP);
for (const [fn, md5] of Object.entries(PROD_MD5)) {
  const got = (await one(`SELECT md5(pg_get_functiondef('public.${fn}'::regproc)) AS m`)).m;
  check(`P0 before-state ${fn} is prod's text`, got === md5, `${got} vs prod ${md5}`);
}

console.log("\n── RED-BEFORE (prod functions, migration NOT applied) ──────────");
await seed({ status: "open", funded: true });
const r1 = await removeAsPoster(LEAD);
const r1j = await job();
check(
  "R1 poster removes the lead: jobs.helper_id still names them, application still accepted",
  r1.ok && r1j.helper_id === LEAD && (await appStatus(LEAD)) === "accepted",
  r1.ok ? `helper_id=${r1j.helper_id}, app=${await appStatus(LEAD)}` : r1.error,
);

await seed({ status: "accepted", needed: 2 });
const r2 = await leave(M2);
check("R2 crew member #2 cannot leave", !r2.ok && /not_authorized/.test(r2.error), r2.error ?? "allowed");

await seed({ status: "accepted", needed: 2, reminders: false });
const r3 = await leave(LEAD);
const r3r = await roster();
check(
  "R3 the lead leaves but keeps their roster row",
  r3.ok && r3r.includes(LEAD),
  r3.ok ? `roster=${r3r.length}, lead on it=${r3r.includes(LEAD)}` : r3.error,
);

await seed({ status: "accepted", needed: 2, slotPhoto: { [M2]: true } });
const r4 = await working(M2);
check(
  "R4 crew member #2 with their own before photo is refused Working",
  !r4.ok && /tracker_requires_before_photo/.test(r4.error),
  r4.error ?? "allowed",
);

// ════════════════════════════════════════════════════════════════════════════
const times = REPLAY ? 3 : 1;
for (let i = 1; i <= times; i++) {
  try {
    await db.exec(MIGRATION);
    console.log(`\napply #${i}: OK`);
  } catch (e) {
    console.log(`\napply #${i}: FAILED — ${e.message ?? e}`);
    failures++;
  }
}
console.log("\n── AFTER (migration applied) ────────────────────────────────────");
// --tree (docs/OPEN.md Q414): run the AFTER cases on helper_cancel_booking
// as the WHOLE migrations tree leaves it, so a later restatement that drops
// this proof's crew branch is red here (src/test/pglite/treeFunction.mjs).
if (process.argv.includes("--tree")) {
  console.log(`--tree: helper_cancel_booking from ${await loadTreeHelperCancel(db)}`);
}

// D1
await seed({ status: "open", funded: true, members: [LEAD, M2, M3], needed: 4 });
const a1 = await removeAsPoster(LEAD);
const a1j = await job();
check(
  "A1 poster removes the lead of a funded crew: lead moves to the earliest remaining member, removed Helpr's application rejected",
  a1.ok && a1j.helper_id === M2 && (await appStatus(LEAD)) === "rejected" && (await appStatus(M2)) === "accepted",
  a1.ok ? `helper_id=${a1j.helper_id}, app=${await appStatus(LEAD)}` : a1.error,
);

await seed({ status: "open", funded: false });
const a2 = await removeAsPoster(LEAD);
const a2j = await job();
check(
  "A2 unfunded crew: the removal succeeds and the lead is cleared (no award on an unfunded job)",
  a2.ok && a2j.helper_id === null && (await appStatus(LEAD)) === "rejected",
  a2.ok ? `helper_id=${a2j.helper_id}` : a2.error,
);

await seed({ status: "open", funded: true });
const a3 = await removeAsPoster(M2);
const a3j = await job();
check(
  "A3 removing a non-lead member leaves the lead alone and rejects that member's application",
  a3.ok && a3j.helper_id === LEAD && (await appStatus(M2)) === "rejected" && (await appStatus(LEAD)) === "accepted",
  a3.ok ? `helper_id=${a3j.helper_id}` : a3.error,
);

await seed({ status: "open", funded: true, members: [LEAD, M2, M3], needed: 4, blocked: [M2] });
const a4 = await removeAsPoster(LEAD);
const a4j = await job();
check(
  "A4 a member the award gate would refuse is skipped: lead goes to the next eligible member",
  a4.ok && a4j.helper_id === M3,
  a4.ok ? `helper_id=${a4j.helper_id}` : a4.error,
);

await seed({ status: "open", funded: true, members: [LEAD, M2], needed: 3, blocked: [M2] });
const a5 = await removeAsPoster(LEAD);
const a5j = await job();
check(
  "A5 no eligible member left: the removal still succeeds and the lead is cleared",
  a5.ok && a5j.helper_id === null,
  a5.ok ? `helper_id=${a5j.helper_id}` : a5.error,
);

await seed({ status: "accepted", funded: true });
const a6 = await removeAsPoster(M2);
check(
  "A6 the poster still cannot remove a member once the crew is booked (policy unchanged)",
  a6.ok && (await roster()).includes(M2),
  a6.ok ? `roster=${(await roster()).length}` : a6.error,
);

// D2
await seed({ status: "accepted", needed: 2 });
const a7 = await leave(M2);
const a7j = await job();
const a7n = await one(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id='${POSTER}' AND title='A Helpr left your crew' AND job_id='${GJOB}'`);
check(
  "A7 crew member #2 leaves a booked crew: off the roster, application rejected, job reopens, poster told, lead unchanged",
  a7.ok && !(await roster()).includes(M2) && (await appStatus(M2)) === "rejected" && a7j.status === "open" && a7j.helper_id === LEAD && a7n.n === 1,
  a7.ok ? `status=${a7j.status}, helper_id=${a7j.helper_id}, notices=${a7n.n}` : a7.error,
);

await seed({ status: "accepted", needed: 2 });
const a8 = await leave(LEAD);
const a8j = await job();
check(
  "A8 the lead leaves a booked, funded crew: off the roster, lead moves to member #2, job reopens",
  a8.ok && !(await roster()).includes(LEAD) && a8j.helper_id === M2 && a8j.status === "open" && (await appStatus(LEAD)) === "rejected",
  a8.ok ? `status=${a8j.status}, helper_id=${a8j.helper_id}, roster=${(await roster()).length}` : a8.error,
);

await seed({ status: "open", needed: 3 });
const a9 = await leave(M2);
check(
  "A9 a member leaves a crew that is still staffing: off the roster, job stays open",
  a9.ok && !(await roster()).includes(M2) && (await job()).status === "open",
  a9.error ?? "",
);

await seed({ status: "accepted", needed: 2 });
const a10 = await leave(OUTSIDER);
check("A10 someone not on the crew cannot use it", !a10.ok && /not_authorized/.test(a10.error), a10.error ?? "allowed");

await seed({ status: "accepted", needed: 2 });
await db.exec(`UPDATE public.group_job_helpers SET helper_completed_at = now() WHERE helper_id='${M2}'`);
const a11 = await leave(M2);
check("A11 a member whose part is done cannot leave", !a11.ok && /not_cancellable/.test(a11.error), a11.error ?? "allowed");

await seed({ status: "accepted", needed: 2, start: "-1 days" });
const a12 = await leave(M2);
check("A12 after the start it is a no-show, not a cancellation", !a12.ok && /job_already_started/.test(a12.error), a12.error ?? "allowed");

await seed({ status: "completed", needed: 2 });
const a13 = await leave(M2);
check("A13 a finished crew job cannot be left", !a13.ok && /not_cancellable/.test(a13.error), a13.error ?? "allowed");

await seed({ status: "accepted", needed: 2 });
const a14 = await leave(LEAD, SJOB);
const a14j = await job(SJOB);
const a14n = await one(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id='${POSTER}' AND title='Your Helpr cancelled'`);
check(
  "A14 single-helper cancel unchanged: job open, helper cleared, application rejected, poster told",
  a14.ok && a14j.status === "open" && a14j.helper_id === null && (await appStatus(LEAD, SJOB)) === "rejected" && a14n.n === 1,
  a14.ok ? `status=${a14j.status}` : a14.error,
);

// D3
await seed({ status: "accepted", needed: 2, slotPhoto: { [M2]: true } });
const a15 = await working(M2);
check("A15 crew member #2 with their own before photo may start Working", a15.ok, a15.error ?? "");

await seed({ status: "accepted", needed: 2, jobPhoto: true });
const a16 = await working(M2);
const a16l = await working(LEAD);
check(
  "A16 the job-level photo clears no crew member's Working step, the lead's included",
  !a16.ok && /tracker_requires_before_photo/.test(a16.error) && !a16l.ok && /tracker_requires_before_photo/.test(a16l.error),
  `member2: ${a16.error ?? "allowed"}; lead: ${a16l.error ?? "allowed"}`,
);

await seed({ status: "accepted", needed: 2 });
const a17 = await working(LEAD);
check("A17 the lead with no photo anywhere is refused", !a17.ok && /tracker_requires_before_photo/.test(a17.error), a17.error ?? "allowed");


// ── Commitment stamps follow the lead (money review, finding 2) ─────────────
await seed({ status: "accepted", needed: 2, confirmed: { [LEAD]: true } });
const a19 = await leave(LEAD);
const a19j = await job();
check(
  "A19 the confirmed lead leaves; the new lead never confirmed: helper_confirmed_at, day-of, deadline and reminder stamps are all NULL",
  a19.ok && a19j.helper_id === M2 && a19j.helper_confirmed_at === null && a19j.helper_dayof_confirmed_at === null && lanesClear(a19j),
  a19.ok ? JSON.stringify({ helper: a19j.helper_id, confirmed: a19j.helper_confirmed_at, dayof: a19j.helper_dayof_confirmed_at, lanesClear: lanesClear(a19j) }) : a19.error,
);

await seed({ status: "accepted", needed: 2, confirmed: { [LEAD]: true, [M2]: true } });
const a20 = await leave(LEAD);
const a20j = await job();
const m2Slot = await one(`SELECT helper_confirmed_at, helper_dayof_confirmed_at FROM public.group_job_helpers WHERE helper_id='${M2}'`);
check(
  "A20 the new lead's OWN roster confirmation becomes the job's; deadline and reminders cleared",
  a20.ok && a20j.helper_id === M2 && iso(a20j.helper_confirmed_at) === iso(m2Slot.helper_confirmed_at) &&
    iso(a20j.helper_dayof_confirmed_at) === iso(m2Slot.helper_dayof_confirmed_at) && a20j.helper_confirmed_at !== null && lanesClear(a20j),
  a20.ok ? `confirmed=${iso(a20j.helper_confirmed_at)} slot=${iso(m2Slot.helper_confirmed_at)}` : a20.error,
);

await seed({ status: "open", funded: true, confirmed: { [LEAD]: true } });
const a21 = await removeAsPoster(LEAD);
const a21j = await job();
check(
  "A21 funded crew, checkout opened: the poster's removal of the confirmed lead succeeds through the money lock; stamps follow the new lead (none)",
  a21.ok && a21j.helper_id === M2 && a21j.helper_confirmed_at === null && lanesClear(a21j),
  a21.ok ? `helper_id=${a21j.helper_id}, confirmed=${a21j.helper_confirmed_at}` : a21.error,
);

await seed({ status: "open", funded: false, confirmed: { [LEAD]: true } });
const a22 = await removeAsPoster(LEAD);
const a22j = await job();
check(
  "A22 unfunded crew: lead and every stamp cleared",
  a22.ok && a22j.helper_id === null && a22j.helper_confirmed_at === null && a22j.helper_dayof_confirmed_at === null && lanesClear(a22j),
  a22.ok ? JSON.stringify(a22j) : a22.error,
);

// The flag is scoped to the trigger's own statement: later in the SAME
// transaction (one multi-statement request), the poster still cannot clear the
// new lead of a funded job.
await seed({ status: "open", funded: true, members: [LEAD, M2, M3], needed: 4 });
const a23 = await asUser(
  POSTER,
  `DELETE FROM public.group_job_helpers WHERE job_id='${GJOB}' AND helper_id='${LEAD}';
   UPDATE public.jobs SET helper_id = NULL WHERE id='${GJOB}';`,
);
const a23j = await job();
check(
  "A23 app.roster_departure does not outlive the trigger's statement: the poster's own clear in the same transaction is refused",
  !a23.ok && /once checkout has opened/.test(a23.error) && a23j.helper_id === LEAD,
  a23.error ?? `allowed (helper_id=${a23j.helper_id})`,
);

// ── A group job from before the roster (finding 6) ──────────────────────────
await seed({ status: "accepted", needed: 2, members: [LEAD], noSlot: [LEAD], reminders: false });
const a24 = await leave(LEAD);
const a24j = await job();
check(
  "A24 a group job's lead with no roster slot cancels through the single-helper path",
  a24.ok && a24j.helper_id === null && a24j.status === "open" && (await appStatus(LEAD)) === "rejected",
  a24.ok ? `status=${a24j.status}, helper=${a24j.helper_id}` : a24.error,
);

// ── Not this fix: the single-helper path as it stands on prod ────────────────
await seed({ status: "accepted", needed: 2 });
await db.exec(`UPDATE public.jobs SET dayof_confirm_reminder_sent_at = now() WHERE id='${SJOB}'`);
const l1 = await leave(LEAD, SJOB);
console.log(
  `NOTE  L1 single-helper cancel after a day-of reminder was sent: ${l1.ok ? "succeeds" : `refused (${l1.error})`}` +
    " — the column whitelist does not list the reminder sent-ats helper_cancel_booking clears (Q402).",
);

const acl = await one(`SELECT
  has_function_privilege('anon', 'public.helper_cancel_booking(uuid)', 'EXECUTE') AS anon_cancel,
  has_function_privilege('authenticated', 'public.helper_cancel_booking(uuid)', 'EXECUTE') AS auth_cancel,
  has_function_privilege('authenticated', 'public.sync_job_after_roster_departure()', 'EXECUTE') AS auth_trg,
  has_function_privilege('anon', 'public.sync_job_after_roster_departure()', 'EXECUTE') AS anon_trg,
  has_function_privilege('authenticated', 'public.enforce_job_tracking_arrival_gate()', 'EXECUTE') AS auth_gate`);
check(
  "A18 grants: cancel is authenticated-only; the trigger functions take no client EXECUTE",
  !acl.anon_cancel && acl.auth_cancel && !acl.auth_trg && !acl.anon_trg && !acl.auth_gate,
  JSON.stringify(acl),
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}${REPLAY ? " (migration applied 3x)" : ""}`);
process.exit(failures === 0 ? 0 : 1);
