#!/usr/bin/env node
/**
 * PGlite proof for 20261005063441_offered_helper_cannot_be_cleared_by_client
 * (docs/OPEN.md Q1325). Harness = directOfferMarkerRpcOnly.pglite.mjs's, with
 * enforce_hire_columns_rpc_only at 20261004184903 (md5 = live 2026-10-05).
 *
 *   node src/test/pglite/offeredHelperNotClearedByClient.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/offeredHelperNotClearedByClient.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), plus the two
 * triggers that bound the direct-offer marker on main, read from their newest
 * definitions: enforce_hire_columns_rpc_only (20260924044812, md5 = live) and
 * jobs_reopen_retires_direct_offer (20261003214350). The definer writers are
 * modelled by SECURITY DEFINER functions owned by the superuser that write the
 * columns the way respond_to_direct_offer (decline) and
 * expire_pending_direct_offers do; `SET ROLE authenticated` is PostgREST.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261005063441_offered_helper_cannot_be_cleared_by_client.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

// The newest CREATE of one function inside one migration file.
function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, close + open[1].length) + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BOOKED = id(1); // booked through an accepted direct offer
const PENDING = id(2); // an open job with a pending direct offer to HELPER
const PENDING2 = id(3); // same, for the server writers
const OPEN = id(4); // a plain open job, no offer
const TARGET = id(5); // a pending offer the targeted Helpr tries to write by hand

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS recurring_helper_id uuid;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261004184903_direct_offer_marker_rpc_only.sql", "enforce_hire_columns_rpc_only"));
await db.exec(`CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();`);
await db.exec(cut("20261003214350_direct_offer_accept_works_like_an_offer.sql", "jobs_reopen_retires_direct_offer"));
await db.exec(`CREATE TRIGGER zzz_jobs_reopen_retires_direct_offer BEFORE UPDATE OF status, helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_reopen_retires_direct_offer();`);
await db.exec(`
-- respond_to_direct_offer's decline and expire_pending_direct_offers' write, as definer RPCs.
CREATE FUNCTION public.zz_decline_offer(p_job uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.jobs SET direct_offer_status = 'declined', direct_offer_expires_at = NULL WHERE id = p_job AND offered_to_helper_id = auth.uid()
$f$;
CREATE FUNCTION public.zz_expire_offers() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  WITH x AS (UPDATE public.jobs SET direct_offer_status = 'expired' WHERE direct_offer_status = 'pending' AND direct_offer_expires_at < now() RETURNING 1) SELECT count(*)::int FROM x
$f$;
-- block_user_and_settle / settle_one_off_jobs_for_banned_account clear the target as definer RPCs.
CREATE FUNCTION public.zz_clear_target(p_job uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.jobs SET offered_to_helper_id = NULL, direct_offer_status = 'declined', direct_offer_expires_at = NULL WHERE id = p_job
$f$;
GRANT EXECUTE ON FUNCTION public.zz_decline_offer(uuid), public.zz_expire_offers(), public.zz_clear_target(uuid) TO authenticated;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget,
                         offered_to_helper_id, direct_offer_status, direct_offer_expires_at) VALUES
  ('${BOOKED}',   '${POSTER}', '${HELPER}', 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'accepted', 'escrow', 100, '${HELPER}', 'accepted', NULL),
  ('${PENDING}',  '${POSTER}', NULL,        'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open',     'escrow', 100, '${HELPER}', 'pending', now() + interval '4 hours'),
  ('${PENDING2}', '${POSTER}', NULL,        'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open',     'escrow', 100, '${HELPER}', 'pending', now() - interval '1 minute'),
  ('${OPEN}',     '${POSTER}', NULL,        'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open',     'escrow', 100, NULL, NULL, NULL),
  ('${TARGET}',   '${POSTER}', NULL,        'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open',     'escrow', 100, '${HELPER}', 'pending', now() + interval '4 hours');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const snap = async (job) => JSON.stringify((await db.query(`SELECT direct_offer_status s, direct_offer_expires_at e FROM public.jobs WHERE id = '${job}'`)).rows[0]);
const patch = (who, job, set) => as(who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;
const target = async (job) => (await db.query(`SELECT offered_to_helper_id t, direct_offer_status s FROM public.jobs WHERE id = '${job}'`)).rows[0];
const MSG = /hire_requires_rpc: jobs\.offered_to_helper_id/;
{
  const r = await patch(POSTER, PENDING, "offered_to_helper_id = NULL");
  const t = await target(PENDING);
  check("R1 the poster cannot clear a pending offer's target (RED on live: rows=1)", !landed(r) && t.t === HELPER && MSG.test(r.err ?? ""), r.ok ? `landed: ${JSON.stringify(t)}` : r.err);
  const h = await patch(HELPER, TARGET, "offered_to_helper_id = NULL");
  const ht = await target(TARGET);
  check("R2 the targeted Helpr cannot clear it either", !landed(h) && ht.t === HELPER, h.ok ? `landed: ${JSON.stringify(ht)}` : h.err);
  const re = await patch(POSTER, OPEN, `offered_to_helper_id = '${HELPER}'`);
  check("R3 still: a client cannot SET a target after posting", !landed(re) && MSG.test(re.err ?? ""), re.ok ? "landed" : re.err);
}
{
  const ok = await patch(POSTER, PENDING, "title = 'Mow the lawn'");
  check("L1 the poster's other edits on an offered job still land", landed(ok), ok.ok ? "" : ok.err);
  const d = await as(POSTER, `SELECT public.zz_clear_target('${PENDING2}')`);
  const dt = await target(PENDING2);
  check("L2 a definer RPC (block / ban settlement) still clears the target", d.ok && dt.t === null && dt.s === "declined", d.ok ? JSON.stringify(dt) : d.err);
  const svc = await patch("service", PENDING, "offered_to_helper_id = NULL");
  check("L3 service_role still may", landed(svc), svc.ok ? "" : svc.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
