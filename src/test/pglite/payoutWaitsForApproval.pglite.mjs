#!/usr/bin/env node
/**
 * PGlite proof for 20261023143240_payout_waits_for_the_posters_approval (owner 2026-10-23: nothing is paid
 * without the poster's approval; the completion notice names the day; past the approval window Helpr
 * support steps in).
 *
 *   node src/test/pglite/payoutWaitsForApproval.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/payoutWaitsForApproval.pglite.mjs  # RED: the bodies before it
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/payoutWaitsForApproval.pglite.mjs
 *
 * Proves, with the migration applied 3 times (replay-safety):
 *   - notify_on_job_update: a single Helpr gets NO second "Job completed!" when the same write scheduled the
 *     payout (the edge already sent the amount and the day); another road to completed says "is complete."
 *     and nothing about payment; every crew member is told the DAY ("Sun, Oct 25"); never "Payment is being
 *     processed" (the 7c6deb77 notice);
 *   - payout_day_label is Louisiana time ("Sat, Oct 24" for 03:00 UTC Oct 25), NULL in NULL out;
 *   - sweep_release_last_chance never says the payment "auto-releases"; it says it stays held;
 *   - job_approval_escalations: service-only table, its CHECKs; admin_approval_escalation_queue shows rows to
 *     admins only (and still_waiting flips once the poster approves); resolve_approval_escalation refuses a
 *     non-admin, audits, and answers false the second time; anon can execute neither.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const NEW_FILE = "20261023143240_payout_waits_for_the_posters_approval.sql";
const MIG = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), "utf8");
const fnFrom = (sql, name) => {
  const i = sql.indexOf(`FUNCTION public.${name}(`);
  const start = sql.lastIndexOf("CREATE", i);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(i))[1];
  const open = sql.indexOf(tag, i) + tag.length;
  return sql.slice(start, sql.indexOf(tag, open) + tag.length) + ";";
};
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const q = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const refused = (r, re) => !Array.isArray(r) && re.test(r?.error ?? "");
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}

const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const POSTER = "aaaaaaaa-0000-0000-0000-000000000002";
const HELPR = "aaaaaaaa-0000-0000-0000-000000000003";
const CREW2 = "aaaaaaaa-0000-0000-0000-000000000004";
const J = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;

// Prod-shaped stubs (the columns and helpers the restated bodies read; read from the migrations that define them).
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${POSTER}'), ('${HELPR}'), ('${CREW2}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.ops_alert_normalise(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim(p_text)) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_seed boolean DEFAULT false, title text, customer_id uuid, helper_id uuid,
  status text, payment_status text, budget numeric, is_group_job boolean DEFAULT false, helpers_needed int,
  poster_completed_at timestamptz, helper_completed_at timestamptz, revision_requested_at timestamptz,
  revision_completed_at timestamptz, revision_acceptance_deadline timestamptz, payout_scheduled_at timestamptz,
  release_last_chance_notif_sent_at timestamptz);
CREATE TABLE public.notifications (id bigserial, user_id uuid, type text, title text, message text, link text,
  read boolean, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text,
  target_type text, target_id text, details jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.defects VALUES (p_fn, p_ref, p_err) $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated, service_role;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
// The bodies before this change (so NEW_MIGRATION=skip is the RED baseline), as prod holds them.
await db.exec(fnFrom(MIG("20260925154606_group_crew_has_no_lead.sql"), "notify_on_job_update"));
await db.exec(fnFrom(MIG("20260926040817_money_sweeps_found_vs_done.sql"), "sweep_release_last_chance"));
await db.exec(`CREATE TRIGGER on_job_update AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_update();`);
if (!skip) {
  const sql = process.env.MIGRATION_PATH ? readFileSync(process.env.MIGRATION_PATH, "utf8") : MIG(NEW_FILE);
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
const notes = async (uid, title) => q(`SELECT message FROM public.notifications WHERE user_id = '${uid}'${title ? ` AND title = '${title}'` : ""} ORDER BY id`);
const clearNotes = () => q(`DELETE FROM public.notifications`);

// ── A. The completion notice ───────────────────────────────────────────────
// A1. The 7c6deb77 shape: the poster's approval scheduled the payout in the same write.
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, helper_completed_at)
  VALUES ('${J(1)}', 'Mow two lawns', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 100, now() - interval '30 minutes')`);
await q(`UPDATE public.jobs SET status = 'completed', payment_status = 'payout_pending', poster_completed_at = now(),
  payout_scheduled_at = '2026-10-25 17:50:35+00' WHERE id = '${J(1)}'`);
const a1 = await notes(HELPR, "Job completed!");
ok(Array.isArray(a1) && a1.length === 0,
  "an approval that scheduled the payout sends NO second \"Job completed!\" (the edge's notice has the amount and the day)");
ok(!(await notes(HELPR)).some((n) => /being processed/.test(n.message)), "  and never \"Payment is being processed\"");
// A2. Another road to completed (an admin's status change): no money claim.
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget)
  VALUES ('${J(2)}', 'Paint fence', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 80)`);
await q(`UPDATE public.jobs SET status = 'completed' WHERE id = '${J(2)}'`);
const a2 = await notes(HELPR, "Job completed!");
ok(Array.isArray(a2) && a2.length === 1 && a2[0].message === '"Paint fence" is complete.',
  "a completion with no payout scheduled says \"is complete.\" and nothing about payment");
// A3. A crew: every member is told the day, in Louisiana time.
await clearNotes();
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, is_group_job, helpers_needed)
  VALUES ('${J(3)}', 'Move a piano', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 300, true, 2)`);
await q(`INSERT INTO public.group_job_helpers VALUES ('${J(3)}', '${HELPR}'), ('${J(3)}', '${CREW2}')`);
await q(`UPDATE public.jobs SET status = 'completed', payment_status = 'payout_pending', poster_completed_at = now(),
  payout_scheduled_at = '2026-10-25 17:50:35+00' WHERE id = '${J(3)}'`);
const c1 = await notes(HELPR, "Job completed!");
const c2 = await notes(CREW2, "Job completed!");
ok(Array.isArray(c1) && c1.length === 1 && Array.isArray(c2) && c2.length === 1,
  "each crew member gets ONE \"Job completed!\" (the first member no longer gets the single-Helpr one too)");
ok(c2[0]?.message === '"Move a piano" is complete. Your share will be sent to your account Sun, Oct 25.',
  `  it names the day: ${JSON.stringify(c2[0]?.message)}`);

// ── B. payout_day_label ────────────────────────────────────────────────────
const lbl = await q(`SELECT public.payout_day_label('2026-10-25 03:00+00') AS a, public.payout_day_label(NULL) AS b,
  public.payout_day_label('2026-10-25 17:50:35+00') AS c`);
ok(lbl[0]?.a === "Sat, Oct 24" && lbl[0]?.b === null && lbl[0]?.c === "Sun, Oct 25",
  `payout_day_label is Louisiana time, NULL in NULL out (${JSON.stringify(lbl[0] ?? lbl)})`);

// ── C. The last warning ────────────────────────────────────────────────────
await clearNotes();
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, helper_completed_at)
  VALUES ('${J(4)}', 'Clean gutters', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 60, now() - interval '23 hours')`);
await q(`SELECT public.sweep_release_last_chance()`);
const lc = await notes(POSTER);
ok(Array.isArray(lc) && lc.length === 1 && !/auto-releas/i.test(lc[0].message) && /stays held/.test(lc[0].message),
  `the last warning never says the payment auto-releases; it says it stays held (${JSON.stringify(lc[0]?.message ?? lc)})`);

// ── D. The approval queue ──────────────────────────────────────────────────
const hasTable = Array.isArray(await q(`SELECT 1 FROM public.job_approval_escalations LIMIT 1`));
ok(hasTable, "job_approval_escalations exists");
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, helper_completed_at)
  VALUES ('${J(5)}', 'Haul brush', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 120, now() - interval '25 hours')`);
ok(Array.isArray(await q(`INSERT INTO public.job_approval_escalations (job_id, reason) VALUES ('${J(5)}', 'approval')`)),
  "the service role files an escalation");
ok(refused(await q(`INSERT INTO public.job_approval_escalations (job_id, reason) VALUES ('${J(4)}', 'timer')`), /check/i),
  "  an unknown reason is refused");
ok(refused(await q(`UPDATE public.job_approval_escalations SET resolved_at = now() WHERE job_id = '${J(5)}'`), /check/i),
  "  a resolution time with no resolution is refused");
ok(refused(await as("authenticated", POSTER, `SELECT * FROM public.job_approval_escalations`), /permission denied/),
  "a member cannot read the table directly");
const memberQ = await as("authenticated", POSTER, `SELECT * FROM public.admin_approval_escalation_queue(false)`);
ok(Array.isArray(memberQ) && memberQ.length === 0, "a member gets no rows from the queue");
ok(refused(await as("anon", null, `SELECT * FROM public.admin_approval_escalation_queue(false)`), /permission denied/),
  "anon cannot call the queue");
const adminQ = await as("authenticated", ADMIN, `SELECT * FROM public.admin_approval_escalation_queue(false)`);
ok(Array.isArray(adminQ) && adminQ.length === 1 && adminQ[0].still_waiting === true && adminQ[0].reason === "approval",
  "an admin sees it, still waiting");
await q(`UPDATE public.jobs SET poster_completed_at = now(), status = 'completed', payment_status = 'payout_pending',
  payout_scheduled_at = now() + interval '3 days' WHERE id = '${J(5)}'`);
const adminQ2 = await as("authenticated", ADMIN, `SELECT * FROM public.admin_approval_escalation_queue(false)`);
ok(Array.isArray(adminQ2) && adminQ2[0]?.still_waiting === false, "  once the poster approves it is no longer waiting");
ok(refused(await as("authenticated", POSTER, `SELECT public.resolve_approval_escalation('${J(5)}')`), /not_authorized/),
  "a member cannot close a queue item");
ok(refused(await as("anon", null, `SELECT public.resolve_approval_escalation('${J(5)}')`), /permission denied/),
  "anon cannot call resolve");
const r1 = await as("authenticated", ADMIN, `SELECT public.resolve_approval_escalation('${J(5)}') AS r`);
const audit = await q(`SELECT * FROM public.admin_audit_log WHERE target_id = '${J(5)}' AND action = 'resolve_approval_escalation'`);
ok(Array.isArray(r1) && r1[0]?.r === true && Array.isArray(audit) && audit.length === 1 && audit[0].admin_id === ADMIN,
  "an admin closes it, and the audit row names them");
const r2 = await as("authenticated", ADMIN, `SELECT public.resolve_approval_escalation('${J(5)}') AS r`);
ok(Array.isArray(r2) && r2[0]?.r === false, "  a second close answers false (nothing open), never a fake success");
const row = (await q(`SELECT * FROM public.job_approval_escalations WHERE job_id = '${J(5)}'`))[0];
ok(row?.resolution === "reviewed" && row?.resolved_by === ADMIN, "  resolution 'reviewed', by that admin");

// ── E. Filing and re-opening (lh-money-escrow review must-fix 2) ───────────
const file = async (job, reason, anchorSql) => (await q(`SELECT public.file_approval_escalation('${job}', '${reason}', ${anchorSql}) AS f`))[0]?.f;
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, helper_completed_at)
  VALUES ('${J(6)}', 'Rake leaves', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 50, now() - interval '30 hours')`);
ok(await file(J(6), "approval", "now() - interval '30 hours'") === true, "the first stall is filed (true: tell everyone)");
ok(await file(J(6), "approval", "now() - interval '30 hours'") === false, "  the next run for the same stall is not (false: nobody is told twice)");
ok(refused(await as("authenticated", ADMIN, `SELECT public.file_approval_escalation('${J(6)}', 'approval', now())`), /permission denied/),
  "  only the service role files (an admin cannot)");
await as("authenticated", ADMIN, `SELECT public.resolve_approval_escalation('${J(6)}')`);
ok(await file(J(6), "approval", "now() - interval '30 hours'") === false, "a stall an admin closed AFTER it began stays closed");
// A new cycle: the poster asked for a fix, the Helpr delivered it after the admin closed the row, the poster ignored it.
ok(await file(J(6), "revision", "now() + interval '1 minute'") === true, "a NEW stall after the close re-opens it (a second stall is never silent)");
const e6 = (await q(`SELECT * FROM public.job_approval_escalations WHERE job_id = '${J(6)}'`))[0];
ok(e6?.reason === "revision" && e6?.resolved_at === null && e6?.resolution === null, "  re-opened as the revision stall, unresolved");
ok(await file(J(6), "revision", "now() - interval '1 hour'") === false, "  an open row filed after this stall began is left alone");
ok(await file(J(6), "revision", "NULL") === false, "  a NULL anchor never re-opens anything");
// The poster's "not done" stands: a requested fix not yet delivered is not waiting on an admin.
await q(`UPDATE public.jobs SET status = 'revision_requested', revision_requested_at = now(), revision_completed_at = NULL WHERE id = '${J(6)}'`);
const q6 = [].concat(await as("authenticated", ADMIN, `SELECT * FROM public.admin_approval_escalation_queue(false)`)).find((r) => r.job_id === J(6));
ok(q6?.still_waiting === false, "while the poster's requested fix is not delivered, the job is NOT waiting on an admin (must-fix 1)");
await q(`UPDATE public.jobs SET revision_completed_at = now(), revision_acceptance_deadline = now() + interval '72 hours' WHERE id = '${J(6)}'`);
const q6c = [].concat(await as("authenticated", ADMIN, `SELECT * FROM public.admin_approval_escalation_queue(false)`)).find((r) => r.job_id === J(6));
ok(q6c?.still_waiting === false, "  nor while the poster's 72 hours to review the delivered fix are still running (re-review should-fix 1)");
await q(`UPDATE public.jobs SET revision_acceptance_deadline = now() - interval '1 minute' WHERE id = '${J(6)}'`);
const q6b = [].concat(await as("authenticated", ADMIN, `SELECT * FROM public.admin_approval_escalation_queue(false)`)).find((r) => r.job_id === J(6));
ok(q6b?.still_waiting === true, "  once the fix is delivered and ignored, it is");

// ── F. The admin alert closes itself ───────────────────────────────────────
const rule = (await q(`SELECT public.admin_alert_close_rule('Job waiting on approval') AS r`))[0]?.r;
ok(rule === "approval-escalation", `"Job waiting on approval" has a close rule (${JSON.stringify(rule)})`);
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status, budget, helper_completed_at)
  VALUES ('${J(7)}', 'Wash windows', '${POSTER}', '${HELPR}', 'in_progress', 'escrow', 70, now() - interval '30 hours')`);
await q(`SELECT public.file_approval_escalation('${J(7)}', 'approval', now() - interval '30 hours')`);
const pending = async () => (await q(`SELECT public.admin_queue_still_pending('approval-escalation', '{"job_id": "${J(7)}"}'::jsonb, now()) AS p`))[0]?.p;
ok(await pending() === true, "  the alert stays open while the job waits on an approval");
await q(`UPDATE public.jobs SET poster_completed_at = now(), status = 'completed', payment_status = 'payout_pending' WHERE id = '${J(7)}'`);
await q(`UPDATE public.job_approval_escalations SET resolved_at = now(), resolution = 'reviewed' WHERE job_id IN ('${J(6)}', '${J(5)}')`);
ok(await pending() === false, "  and closes once the poster approved (and nothing else waits)");
const fk = (await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.job_approval_escalations'::regclass AND contype = 'f' AND confrelid = 'auth.users'::regclass`))[0]?.n;
ok(fk === 1, "resolved_by references auth.users (ON DELETE SET NULL)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
