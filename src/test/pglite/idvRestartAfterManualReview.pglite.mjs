#!/usr/bin/env node
/**
 * PGlite proof for 20261021135734_idv_restart_after_manual_review (owner report
 * 2026-10-21: the ID sheet said "with our team" and never offered a way to
 * verify).
 *
 *   node src/test/pglite/idvRestartAfterManualReview.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/idvRestartAfterManualReview.pglite.mjs  # RED: before it
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Read from supabase/migrations at their newest definition BEFORE this one, any
 * dollar tag: identity_is_verified and claim_idv_attempt (the before state).
 * Stubbed, and said so: the profiles / helper_verifications / notifications /
 * user_roles columns these functions read; notification_crosses_seed_boundary
 * (true when the subject is a seed and the admin is not, its rule for this
 * case); log_cron_defect (records into a table). cron and
 * cron_work_expectations are absent, so the migration's DO block skips both
 * (the guard in src/test/idvRestartAfterManualReview.test.ts pins them).
 *
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021135734_idv_restart_after_manual_review.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest `CREATE OR REPLACE FUNCTION public.<name>(` before THIS, verbatim, any dollar tag. */
function newestBefore(name) {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(MIG_DIR + files[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    const close = src.indexOf(tag, open + tag.length);
    return src.slice(start, close + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${THIS}`);
}

let failures = 0;
const check = (ok, name) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), REAL_ADMIN2 = U(2);
// Claim subjects.
const MR1 = U(11), MR0 = U(12), FAIL0 = U(13), BAN = U(14), VER = U(15), CAP3 = U(16), CAP2 = U(17),
  PEND1 = U(18), PROC = U(19), MRNOR = U(20);
// Alert subjects.
const OLD = U(31), SEEDOLD = U(32), FRESH = U(33), NOHIST = U(34), DECIDED = U(35);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.profiles (
    user_id uuid primary key, idv_status text default 'not_started'
      check (idv_status in ('not_started','pending','processing','verified','failed','manual_review','skipped')),
    stripe_identity_verified boolean not null default false, onboarding_fee_paid boolean not null default false,
    idv_attempt_count integer not null default 0, idv_attempted_at timestamptz, idv_session_id text,
    ban_status text default 'active', is_seed boolean default false, updated_at timestamptz default now());
  create table public.helper_verifications (id serial primary key, user_id uuid, changed_at timestamptz default now(),
    field text, old_value text, new_value text);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text,
    created_at timestamptz default now());
  create table public.user_roles (user_id uuid, role text);
  create table public.cron_defects (fn text, ref text, err text);
  create function public.notification_crosses_seed_boundary(p_recipient uuid, p_job_id uuid, p_link text, p_actor uuid default null)
    returns boolean language sql as $$
      select exists (select 1 from public.profiles where user_id = p_actor and is_seed)
         and not exists (select 1 from public.profiles where user_id = p_recipient and is_seed) $$;
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) returns void language sql as
    $$ insert into public.cron_defects values (p_fn, p_ref, p_err) $$;
  ${newestBefore("identity_is_verified")}
  ${newestBefore("claim_idv_attempt")}
  insert into public.user_roles values ('${ADMIN}', 'admin'), ('${REAL_ADMIN2}', 'admin');
  insert into public.profiles (user_id, idv_status, idv_attempt_count, idv_session_id, ban_status, is_seed) values
    ('${ADMIN}', 'verified', 1, null, 'active', false), ('${REAL_ADMIN2}', 'verified', 1, null, 'active', false),
    ('${MR1}', 'manual_review', 1, 'vs_old', 'active', false),
    ('${MR0}', 'manual_review', 0, null, 'active', true),
    ('${FAIL0}', 'failed', 0, 'vs_x', 'active', false),
    ('${BAN}', 'manual_review', 1, null, 'temp_banned', false),
    ('${VER}', 'verified', 1, 'vs_v', 'active', false),
    ('${CAP3}', 'manual_review', 3, null, 'active', false),
    ('${CAP2}', 'manual_review', 2, null, 'active', false),
    ('${PEND1}', 'pending', 1, 'vs_p', 'active', false),
    ('${PROC}', 'processing', 1, 'vs_q', 'active', false),
    ('${MRNOR}', 'manual_review', 1, 'vs_m', 'active', false),
    ('${OLD}', 'manual_review', 1, null, 'active', false),
    ('${SEEDOLD}', 'manual_review', 1, null, 'active', true),
    ('${FRESH}', 'manual_review', 1, null, 'active', false),
    ('${NOHIST}', 'manual_review', 1, null, 'active', false),
    ('${DECIDED}', 'verified', 1, null, 'active', false);
  update public.profiles set updated_at = now() - interval '30 hours' where user_id = '${NOHIST}';
  insert into public.helper_verifications (user_id, changed_at, field, old_value, new_value) values
    ('${OLD}', now() - interval '40 days', 'idv_status', 'pending', 'manual_review'),
    ('${OLD}', now() - interval '39 days', 'idv_status', 'manual_review', 'pending'),
    ('${OLD}', now() - interval '25 hours', 'idv_status', 'pending', 'manual_review'),
    ('${SEEDOLD}', now() - interval '30 hours', 'idv_status', 'not_started', 'manual_review'),
    ('${FRESH}', now() - interval '2 hours', 'idv_status', 'pending', 'manual_review'),
    ('${DECIDED}', now() - interval '50 hours', 'idv_status', 'pending', 'manual_review');
`);

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));

const q = async (sql) => (await db.query(sql)).rows;
const tryq = async (sql) => {
  try {
    return { ok: true, rows: await q(sql) };
  } catch (e) {
    return { ok: false, err: String(e.message).split("\n")[0] };
  }
};
const claim = async (uid, restart) => {
  const r = await tryq(restart === undefined
    ? `select public.claim_idv_attempt(p_user_id => '${uid}', p_skip_fee_gate => true) c`
    : `select public.claim_idv_attempt(p_user_id => '${uid}', p_skip_fee_gate => true, p_restart => ${restart}) c`);
  return r.ok ? r.rows[0].c : { error: r.err };
};
const prof = async (uid) => (await q(`select idv_status, idv_attempt_count, idv_session_id from public.profiles where user_id = '${uid}'`))[0];

// ---- restart: allowed ------------------------------------------------------
const r1 = await claim(MR1, true);
const p1 = await prof(MR1);
check(r1?.claimed === true && r1.attempt === 2 && p1.idv_status === "pending" && p1.idv_attempt_count === 2 && p1.idv_session_id === null,
  `[fix] R1: manual_review (1 attempt used) restarts: a NEW attempt, pending, old session cleared (${JSON.stringify(r1)} ${JSON.stringify(p1)})`);
const r2 = await claim(MR0, true);
check(r2?.claimed === true && r2.attempt === 1, `[fix] R2: manual_review with no attempt and no session (the prod seed's shape) restarts (${JSON.stringify(r2)})`);
const r7b = await claim(CAP2, true);
check(r7b?.claimed === true && r7b.attempt === 3, `[fix] R3: a third attempt is still the member's own (${JSON.stringify(r7b)})`);
const rp = await claim(PEND1, true);
check(rp?.claimed === true && rp.attempt === 2, `[fix] R4: a pending check whose session cannot be resumed restarts (${JSON.stringify(rp)})`);

// ---- restart: refused ------------------------------------------------------
const r3o = await claim(MRNOR);
check(r3o?.reason === "in_manual_review" && (await prof(MRNOR)).idv_status === "manual_review",
  `[keep] X1: the old call (no p_restart): manual_review is still refused and untouched (${JSON.stringify(r3o)})`);
const r3 = await claim(MRNOR, false);
check(r3?.reason === "in_manual_review", `[fix] X1b: p_restart false is the same refusal (${JSON.stringify(r3)})`);
const f0 = await claim(FAIL0, true);
const f0o = await claim(FAIL0);
check(f0?.reason === "rejected" && f0o?.reason === "rejected" && (await prof(FAIL0)).idv_status === "failed" && (await prof(FAIL0)).idv_attempt_count === 0,
  `[fix] X2: an admin's rejection ('failed') is never escaped, even with no attempt used, restart or not (${JSON.stringify(f0)} / ${JSON.stringify(f0o)})`);
const b = await claim(BAN, true);
check(b?.reason === "account_restricted" && (await prof(BAN)).idv_status === "manual_review",
  `[fix] X3: a banned member's restart is refused, nothing written (${JSON.stringify(b)})`);
const v = await claim(VER, true);
check(v?.reason === "already_verified", `[fix] X4: verified is never asked again, restart or not (${JSON.stringify(v)})`);
const c3 = await claim(CAP3, true);
check(c3?.reason === "in_manual_review" && (await prof(CAP3)).idv_attempt_count === 3,
  `[fix] X5: a fourth attempt is a person's call: refused, nothing spent (${JSON.stringify(c3)})`);
const pr = await claim(PROC, true);
check(pr?.claimed === false && (await prof(PROC)).idv_status === "processing",
  `[fix] X6: while Stripe is processing, no restart (${JSON.stringify(pr)})`);
const pn = await claim(PEND1);
check(pn?.reason === "attempt_limit_reached", `[keep] X7: without a restart, the one-attempt cap is unchanged (${JSON.stringify(pn)})`);
const nv = (await q(`select count(*)::int n from public.profiles where idv_status = 'verified'`))[0].n;
check(nv === 4, `[keep] X8: no claim ever wrote 'verified' (4 verified rows, all seeded: ${nv})`);

// ---- one signature, service role only ---------------------------------------
const sig = (await q(`select to_regprocedure('public.claim_idv_attempt(uuid,integer,boolean)') old3,
  to_regprocedure('public.claim_idv_attempt(uuid,integer,boolean,boolean)') new4`))[0];
check(sig.old3 === null && sig.new4 !== null, `[fix] G1: the 3-argument claim is dropped, the 4-argument one exists (${JSON.stringify(sig)})`);
const acl = await tryq(`select
  has_function_privilege('authenticated', 'public.claim_idv_attempt(uuid,integer,boolean,boolean)', 'execute') a1,
  has_function_privilege('anon', 'public.claim_idv_attempt(uuid,integer,boolean,boolean)', 'execute') a2,
  has_function_privilege('authenticated', 'public.sweep_idv_review_waiting()', 'execute') a3,
  has_function_privilege('anon', 'public.idv_review_waiting_since(uuid)', 'execute') a4,
  has_function_privilege('service_role', 'public.sweep_idv_review_waiting()', 'execute') s1`);
check(acl.ok && !acl.rows[0].a1 && !acl.rows[0].a2 && !acl.rows[0].a3 && !acl.rows[0].a4 && acl.rows[0].s1,
  `[fix] G2: claim, sweep and since run for the service role only (${JSON.stringify(acl.rows?.[0] ?? acl.err)})`);

// ---- the stale clock -------------------------------------------------------
const since = await tryq(`select
  extract(epoch from now() - public.idv_review_waiting_since('${OLD}'))::int / 3600 old_h,
  extract(epoch from now() - public.idv_review_waiting_since('${NOHIST}'))::int / 3600 nohist_h`);
check(since.ok && since.rows[0].old_h === 25 && since.rows[0].nohist_h === 30,
  `[fix] S1: the CURRENT review's start (newest -> manual_review row, 25 h), else updated_at (30 h) (${JSON.stringify(since.rows?.[0] ?? since.err)})`);

// ---- the 24-hour alert -----------------------------------------------------
const run1 = await tryq(`select public.sweep_idv_review_waiting() r`);
const alerts = (await q(`select user_id::text u, title, link, type from public.notifications order by user_id, link`));
const links = new Set(alerts.map((a) => a.link));
check(run1.ok && run1.rows[0].r.alerts === 4 && alerts.length === 4,
  `[fix] A1: one alert per admin for each real member waiting over 24 h (2 members x 2 admins) (${JSON.stringify(run1.rows?.[0] ?? run1.err)}, ${alerts.length} rows)`);
check(links.has(`/admin?view=idvreview&user=${OLD}`) && links.has(`/admin?view=idvreview&user=${NOHIST}`)
  && !links.has(`/admin?view=idvreview&user=${FRESH}`) && !links.has(`/admin?view=idvreview&user=${SEEDOLD}`)
  && !links.has(`/admin?view=idvreview&user=${DECIDED}`),
  `[fix] A2: waiting 25 h and 30 h (updated_at fallback) alert; 2 h, a test account and a decided one do not (${[...links].join(" ")})`);
check(alerts.length > 0 && alerts.every((a) => a.type === "admin_alert" && a.title === "Identity verification needs review — waiting over 24 hours"),
  `[fix] A3: an admin_alert whose title carries the existing idv-review prefix (the Slack mirror, the ledger item and its self-close)`);
const run2 = await tryq(`select public.sweep_idv_review_waiting() r`);
const n2 = (await q(`select count(*)::int n from public.notifications`))[0].n;
check(run2.ok && run2.rows[0].r.alerts === 0 && n2 === 4, `[fix] A4: a second run within 24 h sends nothing more (${n2} rows)`);
// The restart puts a member back in pending: no alert for them while they try.
await q(`update public.profiles set idv_status = 'pending' where user_id = '${OLD}'`);
await q(`delete from public.notifications`);
const run3 = await tryq(`select public.sweep_idv_review_waiting() r`);
const l3 = new Set((await q(`select link from public.notifications`)).map((r) => r.link));
check(run3.ok && !l3.has(`/admin?view=idvreview&user=${OLD}`) && l3.has(`/admin?view=idvreview&user=${NOHIST}`),
  `[fix] A5: once out of manual_review (restarted or decided), no alert`);

if (failures) {
  console.log(`\n${failures} check(s) FAILED${SKIP ? " (expected on the before state)" : ""}`);
  process.exit(1);
}
console.log("\nall checks passed");
