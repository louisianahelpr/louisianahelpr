#!/usr/bin/env node
/**
 * PGlite proof for 20261103075222_offer_closed_on_cancel (docs/OPEN.md Q2011).
 *
 *   node src/test/pglite/offerClosedOnCancel.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/offerClosedOnCancel.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the live jobs trigger chain (scripts/probes/fixtures/
 * dispute-table-door.live.sql), enforce_hire_columns_rpc_only, the Q1891 cancel
 * trigger (20261017134720, md5 = live 2026-11-03), jobs_reopen_retires_direct_offer
 * (20261003214350, md5 = live) and respond_to_direct_offer (20261101071621,
 * md5 = live). Cancel paths modelled: a sanctioned SECURITY DEFINER cancel (how
 * poster_cancel_job writes it) and a service_role UPDATE (auto-expire-jobs).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261103075222_offer_closed_on_cancel.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the live state (expect FAILs)`);

// The newest CREATE of one function inside one migration file.
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
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const OTHER = "5a1e0c2e-0b8e-4c55-9d1a-3f0f6f2c7b11";
const ADMIN = "6b2f1d3f-1c9f-4d66-8e2b-4a1a7a3d8c22";
const id = (n) => `21000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS recurring_helper_id uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS instant_decline_until timestamptz;
CREATE TABLE IF NOT EXISTS public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE OR REPLACE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261027185146_card_hold_at_post.sql", "job_payment_is_listed"));
await db.exec(cut("20261007032040_accept_offer_deadline_floor.sql", "enforce_hire_columns_rpc_only"));
await db.exec(`CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();`);
await db.exec(cut("20261003214350_direct_offer_accept_works_like_an_offer.sql", "jobs_reopen_retires_direct_offer"));
await db.exec(`CREATE TRIGGER zzz_jobs_reopen_retires_direct_offer BEFORE UPDATE OF status, helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_reopen_retires_direct_offer();`);
await db.exec(read(`${MIGDIR}20261017134720_cancel_retires_direct_offer.sql`));
await db.exec(cut("20261101071621_instant_book_decline_race.sql", "respond_to_direct_offer"));
await db.exec(`
REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated, service_role;
-- A sanctioned cancel, written the way poster_cancel_job writes it.
CREATE FUNCTION public.zz_poster_cancel(p_job uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  PERFORM set_config('app.sanctioned_cancel', 'on', true);
  UPDATE public.jobs SET status = 'cancelled'::job_status, cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = 'changed my mind'
   WHERE id = p_job AND customer_id = auth.uid();
  PERFORM set_config('app.sanctioned_cancel', 'off', true);
END $f$;
GRANT EXECUTE ON FUNCTION public.zz_poster_cancel(uuid) TO authenticated;
`);

const POSTER_CANCEL = id(1); // funded, pending offer; the poster cancels
const CRON_CANCEL = id(2); // funded, pending offer; auto-expire-jobs (service role) cancels
const UNFUNDED = id(3); // unpaid, pending offer: the Helpr was never shown it
const HELD = id(4); // card held (listed), pending offer; the poster cancels
const INSTANT = id(5); // an instant booking; the poster cancels
const DECLINED = id(6); // offer already declined; then cancelled
const REOPEN = id(7); // cancelled with a withdrawn offer, then moved back to open
const RESPOND = id(8); // the offered Helpr answers a withdrawn offer
const TOLD = id(9); // the Helpr already holds an "Offer closed" for this job

const row = (n, pay, offer, instant = "NULL") =>
  `('${id(n)}', '${POSTER}', NULL, 'Mow ${n}', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open', '${pay}', 100, '${HELPER}', '${offer}', now() + interval '4 hours', ${instant})`;
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false), ('${HELPER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget,
                         offered_to_helper_id, direct_offer_status, direct_offer_expires_at, instant_decline_until) VALUES
  ${row(1, "escrow", "pending")},
  ${row(2, "escrow", "pending")},
  ${row(3, "unpaid", "pending")},
  ${row(4, "held", "pending")},
  ${row(5, "held", "pending", "now() + interval '2 hours'")},
  ${row(6, "escrow", "declined")},
  ${row(7, "escrow", "pending")},
  ${row(8, "escrow", "pending")},
  ${row(9, "escrow", "pending")};
INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES ('${HELPER}', 'Offer closed', 'earlier', 'warning', '/jobs?job=${id(9)}', '${id(9)}');
`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const offer = async (job) => (await db.query(`SELECT status::text s, direct_offer_status o FROM public.jobs WHERE id = '${job}'`)).rows[0];
const told = async (job) => (await db.query(`SELECT title, message FROM public.notifications WHERE user_id = '${HELPER}' AND job_id = '${job}'`)).rows;

// N1: the poster cancels a funded job: the offered Helpr hears it, once, in the poster's words.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${POSTER_CANCEL}')`);
  const o = await offer(POSTER_CANCEL);
  const n = await told(POSTER_CANCEL);
  check("N1 the poster's cancel tells the offered Helpr 'Offer closed', by the person who posted it",
    r.ok && o.o === "withdrawn" && n.length === 1 && n[0].title === "Offer closed" && /by the person who posted it/.test(n[0].message),
    r.ok ? JSON.stringify({ o, n }) : r.err);
}
// N2: a cron cancel tells the Helpr without saying the poster did it.
{
  const r = await as("service", `UPDATE public.jobs SET status = 'cancelled' WHERE id = '${CRON_CANCEL}' RETURNING id`);
  const n = await told(CRON_CANCEL);
  check("N2 a service-role cancel tells the offered Helpr, without blaming the poster",
    r.ok && n.length === 1 && n[0].title === "Offer closed" && !/posted it/.test(n[0].message), r.ok ? JSON.stringify(n) : r.err);
}
// N3: an unfunded job's offer was never shown, so its close is not news.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${UNFUNDED}')`);
  const o = await offer(UNFUNDED);
  check("N3 an unfunded job's cancel withdraws the offer and tells the Helpr nothing",
    r.ok && o.o === "withdrawn" && (await told(UNFUNDED)).length === 0, r.ok ? JSON.stringify(o) : r.err);
}
// N4: a held card is listed: the Helpr was told about the offer, so is told it closed.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${HELD}')`);
  check("N4 a held-card job's cancel tells the offered Helpr", r.ok && (await told(HELD)).length === 1, r.ok ? "" : r.err);
}
// N5: an instant booking has its own words; no "Offer closed".
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${INSTANT}')`);
  check("N5 an instant booking's cancel sends no 'Offer closed'", r.ok && (await told(INSTANT)).length === 0, r.ok ? "" : r.err);
}
// N6: an answered offer is not closed by the cancel.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${DECLINED}')`);
  const o = await offer(DECLINED);
  check("N6 a declined offer stays declined and its Helpr is not told again", r.ok && o.o === "declined" && (await told(DECLINED)).length === 0, r.ok ? JSON.stringify(o) : r.err);
}
// N7: re-cancelling (a second status write) never repeats the notice.
{
  await as("service", `UPDATE public.jobs SET status = 'cancelled' WHERE id = '${POSTER_CANCEL}'`);
  check("N7 a second write on the cancelled job does not repeat the notice", (await told(POSTER_CANCEL)).length === 1);
}
// N8: a Helpr who already holds an "Offer closed" for the job is not told twice.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${TOLD}')`);
  const n = await told(TOLD);
  check("N8 an existing 'Offer closed' for the job is not repeated", r.ok && n.length === 1 && n[0].message === "earlier", r.ok ? JSON.stringify(n) : r.err);
}
// R1: a cancelled job moved back to open carries a public offer status.
{
  await as(POSTER, `SELECT public.zz_poster_cancel('${REOPEN}')`);
  const before = await offer(REOPEN);
  // An admin write (the status-transition gate lets an admin past; how an
  // admin RPC running as definer would write it).
  await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')`);
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${ADMIN}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  let r;
  try { await db.query(`UPDATE public.jobs SET status = 'open' WHERE id = '${REOPEN}'`); r = { ok: true }; }
  catch (e) { r = { ok: false, err: e.message }; }
  const o = await offer(REOPEN);
  check("R1 a reopen of a cancelled job maps 'withdrawn' to 'expired'", before.o === "withdrawn" && r.ok && o.s === "open" && o.o === "expired", r.ok ? JSON.stringify({ before, o }) : r.err);
}
// E1/E2: answering a withdrawn offer says the job is closed; a stranger is still refused first.
{
  await as(POSTER, `SELECT public.zz_poster_cancel('${RESPOND}')`);
  const r = await as(HELPER, `SELECT public.respond_to_direct_offer('${RESPOND}', true)`);
  check("E1 the offered Helpr answering a withdrawn offer gets job_not_open", !r.ok && /job_not_open/.test(r.err), r.ok ? "answered ok" : r.err);
  const s = await as(OTHER, `SELECT public.respond_to_direct_offer('${RESPOND}', false)`);
  check("E2 someone else still gets not_your_offer", !s.ok && /not_your_offer/.test(s.err), s.ok ? "answered ok" : s.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
