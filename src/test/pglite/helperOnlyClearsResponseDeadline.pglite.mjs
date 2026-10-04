#!/usr/bin/env node
/**
 * PGlite proof for 20261004192041_helper_only_clears_response_deadline (docs/OPEN.md Q1202).
 *
 *   node src/test/pglite/helperOnlyClearsResponseDeadline.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helperOnlyClearsResponseDeadline.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), with
 * enforce_helper_jobs_column_whitelist replaced by its newest definition on
 * main (20260927220819, md5 = live). The decline RPC is modelled by a SECURITY
 * DEFINER function owned by the superuser that clears helper_id and
 * response_deadline as decline_job_offer does; it runs with auth.uid() = the
 * Helpr, exactly the seat the whitelist judges.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261004192041_helper_only_clears_response_deadline.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

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
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OFFER = id(1); // an offer the Helpr has not confirmed, 2h window

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION public.zz_decline(p_job uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.jobs SET helper_id = NULL, response_deadline = NULL, status = 'open' WHERE id = p_job AND helper_id = auth.uid()
$f$;
GRANT EXECUTE ON FUNCTION public.zz_decline(uuid) TO authenticated;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20260927220819_helper_cancel_resets_dayof_stamps.sql", "enforce_helper_jobs_column_whitelist"));
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

const SEED = `now() + interval '2 hours'`;
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget, response_deadline)
VALUES ('${OFFER}', '${POSTER}', '${HELPR}', 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'accepted', 'escrow', 100, ${SEED});
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const deadline = async () => (await db.query(`SELECT response_deadline d FROM public.jobs WHERE id = '${OFFER}'`)).rows[0].d;
const reset = async () => { await db.exec("RESET ROLE; SELECT set_config('request.uid', '', false); SELECT set_config('request.jwt.claim.role', '', false);"); await db.query(`UPDATE public.jobs SET helper_id = '${HELPR}', status = 'accepted', response_deadline = ${SEED} WHERE id = '${OFFER}'`); };
const MSG = /Helpers may only clear jobs\.response_deadline, not move it/;

for (const [label, set] of [
  ["R1 the Helpr cannot push the offer's window out a year", `response_deadline = now() + interval '1 year'`],
  ["R2 ...nor by an hour", `response_deadline = response_deadline + interval '1 hour'`],
]) {
  await reset();
  const before = String(await deadline());
  const r = await as(HELPR, `UPDATE public.jobs SET ${set} WHERE id = '${OFFER}' RETURNING id`);
  const after = String(await deadline());
  check(label, !(r.ok && r.rows.length) && before === after && MSG.test(r.err ?? ""), r.ok ? `moved: ${before} -> ${after}` : r.err);
}
{
  await reset();
  const r = await as(HELPR, `SELECT public.zz_decline('${OFFER}')`);
  check("L1 the decline RPC (definer, run as the Helpr) still clears the window", r.ok && (await deadline()) === null, r.ok ? String(await deadline()) : r.err);
}
{
  await reset();
  const r = await as("service", `UPDATE public.jobs SET response_deadline = now() + interval '4 hours' WHERE id = '${OFFER}' RETURNING id`);
  check("L2 a server write may still set the window", r.ok && r.rows.length === 1, r.ok ? "" : r.err);
}
{
  await reset();
  const r = await as(HELPR, `UPDATE public.jobs SET response_deadline = NULL WHERE id = '${OFFER}' RETURNING id`);
  check("L3 the Helpr's own clear of the window is not refused by this check", r.ok || !MSG.test(r.err ?? ""), r.ok ? `${r.rows.length} row(s)` : r.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
