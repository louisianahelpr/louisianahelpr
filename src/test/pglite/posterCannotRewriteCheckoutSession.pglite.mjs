#!/usr/bin/env node
/**
 * PGlite proof for 20261007032429_poster_cannot_rewrite_checkout_session (docs/OPEN.md Q1366).
 *
 *   node src/test/pglite/posterCannotRewriteCheckoutSession.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/posterCannotRewriteCheckoutSession.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), with
 * enforce_poster_jobs_money_lock replaced by its newest definition on main
 * (20261004193548, md5 = live 4053b19c…) and the crew shape lock
 * (enforce_group_job_has_no_lead, 20260925154606) attached, so helpers_needed
 * is shown locked by the lock that already owns it. `SET ROLE authenticated`
 * is PostgREST with a user JWT; service_role is an edge function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261007032429_poster_cannot_rewrite_checkout_session.sql`);
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
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BOOKED = id(1);
const OPEN = id(2);

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at timestamptz;
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
GRANT SELECT ON public.group_job_helpers TO authenticated, service_role;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261004193548_booked_job_terms_locked.sql", "enforce_poster_jobs_money_lock"));
await db.exec(cut("20260925154606_group_crew_has_no_lead.sql", "enforce_group_job_has_no_lead"));
await db.exec(`CREATE TRIGGER trg_group_job_has_no_lead BEFORE INSERT OR UPDATE OF helper_id, is_group_job, helpers_needed ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_group_job_has_no_lead();`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget,
                         requires_w9, credential_tier, pricing_mode, is_recurring, recurrence_interval, department, business_id, helpers_needed) VALUES
  ('${BOOKED}', '${POSTER}', '${HELPER}', 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'accepted', 'escrow', 100,
                false, 0, 'set_price', false, NULL, NULL, NULL, 1),
  ('${OPEN}',   '${POSTER}', NULL,        'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open',     'unpaid', 100,
                false, 0, 'set_price', false, NULL, NULL, NULL, 1);
UPDATE public.jobs SET stripe_session_id = 'cs_live_A' WHERE id = '${OPEN}';
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const snap = async (job) => JSON.stringify((await db.query(`SELECT to_jsonb(j) AS r FROM public.jobs j WHERE id = '${job}'`)).rows[0].r);
const patch = (who, job, set) => as(who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;
const MSG = /Posters may not change jobs\.(\w+) once a Helpr is booked/;

const LOCKED = /Posters may not modify jobs\.stripe_session_id/;
{
  const before = await snap(OPEN);
  const r = await patch(POSTER, OPEN, `stripe_session_id = 'cs_other'`);
  check("P-rewrite: the poster cannot point the job at another session", !landed(r) && before === (await snap(OPEN)) && LOCKED.test(r.err ?? ""), r.ok ? "landed" : r.err);
}
{
  const before = await snap(OPEN);
  const r = await patch(POSTER, OPEN, `stripe_session_id = NULL`);
  check("P-clear: the poster cannot clear the open checkout", !landed(r) && before === (await snap(OPEN)) && LOCKED.test(r.err ?? ""), r.ok ? "landed" : r.err);
}
{
  const before = await snap(BOOKED);
  const r = await patch(POSTER, BOOKED, `stripe_session_id = 'cs_other'`);
  check("P-funded: the poster cannot set it on a funded job either", !landed(r) && before === (await snap(BOOKED)) && LOCKED.test(r.err ?? ""), r.ok ? "landed" : r.err);
}
{
  await as("service", `UPDATE public.jobs SET stripe_session_id = NULL WHERE id = '${OPEN}'`);
  const r = await patch(POSTER, OPEN, `title = 'Mow the lawn'`);
  check("O-title: the poster's ordinary edit on an open job with no session still lands", landed(r), r.ok ? "" : r.err);
}
{
  const r = await patch("service", OPEN, `stripe_session_id = 'cs_live_B'`);
  check("S-stamp: create-payment's service-role stamp lands", landed(r), r.ok ? "" : r.err);
  const c = await patch("service", OPEN, `stripe_session_id = NULL`);
  check("S-clear: stripe-webhook's service-role clear lands", landed(c), c.ok ? "" : c.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
