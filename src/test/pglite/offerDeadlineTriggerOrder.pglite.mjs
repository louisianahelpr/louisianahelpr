#!/usr/bin/env node
/**
 * PGlite proof of trigger ORDER for zzzz_offer_deadline_follows_start
 * (20261005184940, docs/OPEN.md Q1404; lh-money-escrow review of Q1398).
 *
 *   node src/test/pglite/offerDeadlineTriggerOrder.pglite.mjs                   # GREEN
 *   TRIGGER_FIRST=1 node src/test/pglite/offerDeadlineTriggerOrder.pglite.mjs   # RED: the clamp fires before the whitelist
 *
 * offerDeadlineBeforeStart.pglite.mjs proves WHAT the trigger does on a bare
 * jobs table. This proves it runs WHERE it must: after
 * trg_helper_jobs_column_whitelist and the rest of the LIVE BEFORE UPDATE chain
 * (scripts/probes/fixtures/dispute-table-door.live.sql), because when a Helpr
 * accepts a date change (respond_job_schedule_change, which runs AS the Helpr
 * with app.schedule_change_rpc = '1') the clamp moves response_deadline, and
 * the whitelist refuses any Helpr write that MOVES response_deadline (Q1202).
 * BEFORE triggers fire in name order, so the clamp's 'zzzz_' name is the whole
 * guarantee; TRIGGER_FIRST=1 creates it as 'aaaa_' and the Helpr's accept is
 * refused.
 *
 * Fixture: the LIVE chain, with enforce_helper_jobs_column_whitelist and
 * is_server_context replaced by their newest definitions on main. The RPC is
 * modelled by a SECURITY DEFINER function that sets the flag and moves the
 * date, run with auth.uid() = the Helpr (the seat the whitelist judges).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const FIRST = process.env.TRIGGER_FIRST === "1";
if (FIRST) console.log("TRIGGER_FIRST=1: the clamp is created as aaaa_ (expect FAILs)");

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261004192041_helper_only_clears_response_deadline.sql", "enforce_helper_jobs_column_whitelist"));
const MIG = "20261005184940_offer_deadline_before_start.sql";
await db.exec(cut(MIG, "job_offer_cutoff"));
await db.exec(cut(MIG, "offer_deadline_follows_start"));
const TRG = FIRST ? "aaaa_offer_deadline_follows_start" : "zzzz_offer_deadline_follows_start";
await db.exec(`CREATE TRIGGER ${TRG} BEFORE UPDATE OF date_needed, start_time ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.offer_deadline_follows_start();`);
await db.exec(`
CREATE FUNCTION public.zz_accept_schedule_change(p_job uuid, p_date date, p_time time) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  PERFORM set_config('app.schedule_change_rpc', '1', true);
  UPDATE public.jobs SET date_needed = p_date, start_time = p_time WHERE id = p_job AND helper_id = auth.uid();
  PERFORM set_config('app.schedule_change_rpc', '', true);
END $f$;
GRANT EXECUTE ON FUNCTION public.zz_accept_schedule_change(uuid, date, time) TO authenticated;
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
-- An unconfirmed offer: the Helpr has until tomorrow evening; the job is in 3 days.
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget, response_deadline)
VALUES ('${JOB}', '${POSTER}', '${HELPR}', 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 3, '09:00', 'accepted', 'escrow', 100, now() + interval '36 hours');
`);

// The order the chain really fires in (BEFORE UPDATE, name order).
const order = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map((r) => r.tgname);
const iClamp = order.findIndex((n) => n.endsWith("offer_deadline_follows_start"));
const iWhitelist = order.indexOf("trg_helper_jobs_column_whitelist");
check("the clamp sorts after the column whitelist (BEFORE triggers fire in name order)", iWhitelist >= 0 && iClamp > iWhitelist, order.join(" > "));
// The fixture is the 2026-09-14 chain; prod has grown. Read live 2026-10-07
// (pg_trigger, BEFORE UPDATE on public.jobs, name order): the clamp must still
// sort after every trigger that judges a response_deadline change.
const LIVE_ORDER_2026_10_07 = "enforce_job_budget > jobs_award_gate > jobs_track_revision_scope_creep > set_revision_deadline_trigger > trg_ban_gate_jobs_update > trg_cancellation_requires_rpc > trg_chargeback_due_server_owned > trg_completion_on_live_job > trg_confirm_on_live_job > trg_dispute_markers_server_owned > trg_enforce_job_status_transition > trg_enforce_series_columns_client_lock > trg_funded_category_tax_class > trg_group_job_has_no_lead > trg_helper_completion_gates > trg_helper_jobs_column_whitelist > trg_hire_columns_rpc_only > trg_job_expiry_floor > trg_job_funded_before_award > trg_jobs_dispute_evidence_append_only > trg_jobs_stamp_accepted_at > trg_poster_jobs_money_lock > trg_prevent_job_field_escalation > trg_refuse_payout_pending_during_ban_review > trg_reject_contact_leak_in_job > trg_series_ban_marker_server_owned > trg_series_visit_within_end > trg_set_dispute_deadline > trg_stamp_recurring_series_helper > trg_sync_has_active_dispute > update_jobs_updated_at > zz_jobs_arrival_integrity > zz_jobs_completion_server_owned > zz_jobs_stamp_completed_at > zz_refuse_unconfirmed_email_write > zzz_jobs_reopen_retires_direct_offer > zzzz_offer_deadline_follows_start > zzzzz_jobs_route_notes".split(" > ");
const live = [...LIVE_ORDER_2026_10_07.filter((n) => !n.endsWith("offer_deadline_follows_start")), TRG].sort();
const judges = ["trg_helper_jobs_column_whitelist", "trg_hire_columns_rpc_only"];
check("in the live chain (2026-10-07) the clamp sorts after every trigger that judges response_deadline", judges.every((j) => live.indexOf(j) < live.indexOf(TRG)), live.slice(live.indexOf(TRG) - 1, live.indexOf(TRG) + 2).join(" > "));

// The Helpr accepts the poster's request to start TOMORROW at 07:00, earlier
// than the offer's window: the clamp must pull response_deadline to the new
// start, and the whitelist must not refuse the RPC's write.
await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${HELPR}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
let err = null;
try { await db.query(`SELECT public.zz_accept_schedule_change('${JOB}', current_date + 1, '07:00')`); }
catch (e) { err = e.message; }
await db.exec("RESET ROLE");
const row = (await db.query(`SELECT date_needed, response_deadline, public.job_offer_cutoff(date_needed, start_time) AS cutoff FROM public.jobs WHERE id = '${JOB}'`)).rows[0];
check("the Helpr's accepted date change is not refused by the whitelist", err === null, err ?? "");
check("the offer's window now ends no later than the new start", err === null && new Date(row.response_deadline) <= new Date(row.cutoff), `deadline ${row.response_deadline} cutoff ${row.cutoff}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
