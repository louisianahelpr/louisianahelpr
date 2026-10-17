#!/usr/bin/env node
/**
 * PGlite proof for 20261017134720_cancel_retires_direct_offer (docs/OPEN.md Q1891).
 *
 *   node src/test/pglite/cancelRetiresDirectOffer.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cancelRetiresDirectOffer.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain (scripts/probes/fixtures/
 * dispute-table-door.live.sql: the cancellation gate, the status-transition
 * gate), plus enforce_hire_columns_rpc_only and jobs_reopen_retires_direct_offer
 * from their newest definitions, and expire_pending_direct_offers as it is on
 * main (20261003214350, md5 = live 2026-10-17). Cancel paths modelled: a
 * sanctioned SECURITY DEFINER cancel (how poster_cancel_job and the other
 * RPCs write it) and a service_role UPDATE (auto-expire-jobs, create-payment).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261017134720_cancel_retires_direct_offer.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

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
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER_CANCEL = id(1); // open, pending offer; the poster cancels it
const EDGE_CANCEL = id(2); // open, pending offer; a service-role writer cancels it
const DECLINED = id(3); // open, offer already declined; then cancelled
const LAPSED_OPEN = id(4); // open, pending offer past its window: the sweep expires it
const LAPSED_CANCELLED = id(5); // cancelled while pending (main's leak), window passed
const UNTOUCHED = id(6); // open, pending offer; an unrelated column changes

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS recurring_helper_id uuid;
CREATE TABLE IF NOT EXISTS public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE OR REPLACE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261007032040_accept_offer_deadline_floor.sql", "enforce_hire_columns_rpc_only"));
await db.exec(`CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();`);
await db.exec(cut("20261003214350_direct_offer_accept_works_like_an_offer.sql", "jobs_reopen_retires_direct_offer"));
await db.exec(`CREATE TRIGGER zzz_jobs_reopen_retires_direct_offer BEFORE UPDATE OF status, helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_reopen_retires_direct_offer();`);
await db.exec(cut("20261003214350_direct_offer_accept_works_like_an_offer.sql", "expire_pending_direct_offers"));
await db.exec(`
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

const row = (n, status, offer, exp) =>
  `('${id(n)}', '${POSTER}', NULL, 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', '${status}', 'escrow', 100, '${HELPER}', ${offer ? `'${offer}'` : "NULL"}, ${exp})`;
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget,
                         offered_to_helper_id, direct_offer_status, direct_offer_expires_at) VALUES
  ${row(1, "open", "pending", "now() + interval '4 hours'")},
  ${row(2, "open", "pending", "now() + interval '4 hours'")},
  ${row(3, "open", "declined", "NULL")},
  ${row(4, "open", "pending", "now() - interval '1 minute'")},
  ${row(5, "cancelled", "pending", "now() - interval '1 minute'")},
  ${row(6, "open", "pending", "now() + interval '4 hours'")};
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
const notes = async (job) => Number((await db.query(`SELECT count(*)::int n FROM public.notifications WHERE link LIKE '%${job}'`)).rows[0].n);

// B1: the backfill (a cancelled job planted with a pending offer, main's leak).
{
  const o = await offer(LAPSED_CANCELLED);
  check("B1 a cancelled job already holding a pending offer is retired by the migration", o.o === "withdrawn", JSON.stringify(o));
}
// C1: the poster cancels through a sanctioned definer cancel.
{
  const r = await as(POSTER, `SELECT public.zz_poster_cancel('${POSTER_CANCEL}')`);
  const o = await offer(POSTER_CANCEL);
  check("C1 the poster's cancel retires the pending offer", r.ok && o.s === "cancelled" && o.o === "withdrawn", r.ok ? JSON.stringify(o) : r.err);
}
// C2: a service-role writer cancels (auto-expire-jobs, create-payment).
{
  const r = await as("service", `UPDATE public.jobs SET status = 'cancelled' WHERE id = '${EDGE_CANCEL}' RETURNING id`);
  const o = await offer(EDGE_CANCEL);
  check("C2 a service-role cancel retires the pending offer", r.ok && o.s === "cancelled" && o.o === "withdrawn", r.ok ? JSON.stringify(o) : r.err);
}
// L1: an answered offer keeps its answer through a cancel.
{
  const r = await as("service", `UPDATE public.jobs SET status = 'cancelled' WHERE id = '${DECLINED}' RETURNING id`);
  const o = await offer(DECLINED);
  check("L1 a declined offer stays declined when the job is cancelled", r.ok && o.o === "declined", r.ok ? JSON.stringify(o) : r.err);
}
// L2: a write that does not cancel leaves a pending offer alone.
{
  const r = await as("service", `UPDATE public.jobs SET title = 'Mow the back too' WHERE id = '${UNTOUCHED}' RETURNING id`);
  const o = await offer(UNTOUCHED);
  check("L2 an unrelated update leaves the pending offer pending", r.ok && o.o === "pending", r.ok ? JSON.stringify(o) : r.err);
}
// S1/S2: the sweep.
{
  // Re-plant main's leak on one more row with triggers off, so the sweep's own filter is what is tested.
  await db.exec(`SET session_replication_role = replica; UPDATE public.jobs SET status = 'cancelled', direct_offer_status = 'pending', direct_offer_expires_at = now() - interval '1 minute' WHERE id = '${LAPSED_CANCELLED}'; SET session_replication_role = origin;`);
  const before = await notes(LAPSED_CANCELLED);
  const r = await db.query(`SELECT public.expire_pending_direct_offers() AS n`);
  const open = await offer(LAPSED_OPEN);
  const cancelled = await offer(LAPSED_CANCELLED);
  check("S1 the sweep still expires a lapsed offer on an open job", open.o === "expired" && (await notes(LAPSED_OPEN)) === 1, `${JSON.stringify(open)} n=${r.rows[0].n}`);
  check("S2 the sweep leaves a cancelled job alone and tells its poster nothing", cancelled.o === "pending" && (await notes(LAPSED_CANCELLED)) === before, `${JSON.stringify(cancelled)} notices ${before} -> ${await notes(LAPSED_CANCELLED)}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
