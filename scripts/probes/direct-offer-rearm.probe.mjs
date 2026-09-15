#!/usr/bin/env node
/**
 * Probe for 20260915192148: a direct offer can't be re-opened on a hired or
 * non-open job. Base: the live-prod jobs fixture (policies, poster lock,
 * prevent_job_field_escalation verbatim) + is_server_context() as live
 * (20260915101102). BEFORE reproduces the re-arm; AFTER applies the migration
 * 3x; broken copies must each be caught. PGlite from ~/.lh-pglite-probe.
 */
import fs from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const LIVE_BASE = read("./fixtures/dispute-table-door.live.sql");
const MIG = read("../../supabase/migrations/20260915192148_block_direct_offer_rearm.sql");

const POSTER = "76b07824-9b41-4741-a4c4-4f8de362f682";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const T = "44444444-4444-4444-8444-444444444444";
const J = {
  HIRED: "50000000-0000-4000-8000-000000000001", // in_progress, funded, Helpr hired
  CANC: "50000000-0000-4000-8000-000000000002",  // cancelled, no Helpr
  OPEN: "50000000-0000-4000-8000-000000000003",  // open, funded, no Helpr, no offer
  PEND: "50000000-0000-4000-8000-000000000004",  // open, pending offer to T
  HIRED2: "50000000-0000-4000-8000-000000000005", // in_progress, offer accepted earlier
  ODD: "50000000-0000-4000-8000-000000000006",   // status still 'open' but a Helpr is set (defence in depth)
};
const EXTRA = `
-- is_server_context() as live after 20260915101102 (auth.role() is not in the
-- fixture; the role GUC check is the part a client cannot pass).
CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NULL AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, stripe_session_id, budget, offered_to_helper_id, direct_offer_status, is_seed) VALUES
  ('${J.HIRED}',  '${POSTER}', '${HELPER}', 'hired',  'in_progress', 'escrow', 'cs_1', 100, NULL, NULL, true),
  ('${J.CANC}',   '${POSTER}', NULL,        'canc',   'cancelled',   'refunded', 'cs_2', 100, NULL, NULL, true),
  ('${J.OPEN}',   '${POSTER}', NULL,        'open',   'open',        'escrow', 'cs_3', 100, NULL, NULL, true),
  ('${J.PEND}',   '${POSTER}', NULL,        'pend',   'open',        'escrow', 'cs_4', 100, '${T}', 'pending', true),
  ('${J.HIRED2}', '${POSTER}', '${HELPER}', 'hired2', 'in_progress', 'escrow', 'cs_5', 100, '${HELPER}', 'accepted', true),
  ('${J.ODD}',    '${POSTER}', '${HELPER}', 'odd',    'open',        'escrow', 'cs_6', 100, NULL, NULL, true);
`;
async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "RESET ROLE");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message, code: e.code }; }
  finally { await db.exec("RESET ROLE"); }
}
const landed = (r) => r.ok && r.rows.length === 1;
const row = async (db, id) => (await db.query(`SELECT offered_to_helper_id, direct_offer_status, helper_id, status FROM public.jobs WHERE id = '${id}'`)).rows[0];
const rearm = (db, who, id, to = T) => as(db, who, `UPDATE public.jobs SET offered_to_helper_id = '${to}', direct_offer_status = 'pending' WHERE id = '${id}' RETURNING id`);

async function expectations(db) {
  const bad = [];
  const check = (c, m) => { if (!c) bad.push(m); };
  // A. Poster re-arms an offer on a hired job: refused, row unchanged, and T gets no seat.
  let r = await rearm(db, POSTER, J.HIRED);
  check(!r.ok && /direct_offer_job_not_open/.test(r.err), `A hired re-arm: expected refusal, got ${r.ok ? r.rows.length + " rows" : r.err}`);
  let j = await row(db, J.HIRED);
  check(j.offered_to_helper_id === null, `A hired job now offered to ${j.offered_to_helper_id}`);
  const seat = await as(db, T, `UPDATE public.jobs SET title = 'hijacked' WHERE id = '${J.HIRED}' RETURNING id`);
  check(!landed(seat), "A offeree T could update the hired job");
  // B. Re-arming the already-accepted offer back to pending on a hired job: refused.
  r = await as(db, POSTER, `UPDATE public.jobs SET direct_offer_status = 'pending' WHERE id = '${J.HIRED2}' RETURNING id`);
  check(!r.ok && /direct_offer_job_not_open/.test(r.err), `B accepted->pending on hired: expected refusal, got ${r.ok ? r.rows.length + " rows" : r.err}`);
  // C. A cancelled job can't be re-offered.
  r = await rearm(db, POSTER, J.CANC);
  check(!r.ok && /direct_offer_job_not_open/.test(r.err), `C cancelled re-arm: expected refusal, got ${r.ok ? r.rows.length + " rows" : r.err}`);
  // D. An open job with no Helpr still can be (the trigger adds no new refusal there).
  r = await rearm(db, POSTER, J.OPEN);
  check(r.ok || !/direct_offer_job_not_open/.test(r.err ?? ""), `D open job: this migration refused it (${r.err})`);
  // E. The offeree declines a pending offer (respond_to_direct_offer's write): allowed.
  r = await as(db, T, `UPDATE public.jobs SET direct_offer_status = 'declined' WHERE id = '${J.PEND}' RETURNING id`);
  check(r.ok || !/direct_offer_job_not_open/.test(r.err ?? ""), `E decline: this migration refused it (${r.err})`);
  // F. Clearing an offer on a hired job: allowed by this trigger.
  r = await as(db, POSTER, `UPDATE public.jobs SET offered_to_helper_id = NULL, direct_offer_status = 'cancelled' WHERE id = '${J.HIRED2}' RETURNING id`);
  check(r.ok || !/direct_offer_job_not_open/.test(r.err ?? ""), `F clear on hired: this migration refused it (${r.err})`);
  // G. Server context (no uid, not a client role) is exempt.
  r = await as(db, null, `UPDATE public.jobs SET offered_to_helper_id = '${T}', direct_offer_status = 'pending' WHERE id = '${J.HIRED}' RETURNING id`);
  check(landed(r), `G server re-arm: expected allowed, got ${r.ok ? r.rows.length + " rows" : r.err}`);
  await db.exec(`UPDATE public.jobs SET offered_to_helper_id = NULL, direct_offer_status = NULL WHERE id = '${J.HIRED}'`);
  // I. A Helpr on the row is enough, whatever the status says.
  r = await rearm(db, POSTER, J.ODD);
  check(!r.ok && /direct_offer_job_not_open/.test(r.err), `I open-but-hired re-arm: expected refusal, got ${r.ok ? r.rows.length + " rows" : r.err}`);
  // H. The trigger function is not client-callable.
  const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'enforce_direct_offer_not_rearmed'`)).rows[0]?.a ?? "";
  check(!/anon=|authenticated=|^\{=X/.test(acl), `H function ACL ${acl}`);
  return bad;
}
async function fresh(migs) {
  const db = new PGlite();
  await db.exec(LIVE_BASE);
  await db.exec(EXTRA);
  for (const m of migs) await db.exec(m);
  return db;
}
let fail = false;
{
  const db = await fresh([]);
  const r = await rearm(db, POSTER, J.HIRED);
  const seat = await as(db, T, `UPDATE public.jobs SET title = 'hijacked' WHERE id = '${J.HIRED}' RETURNING id`);
  console.log("== BEFORE (prod shape)");
  console.log(`${landed(r) ? "GAP   " : "closed"} poster re-arms a direct offer on a hired, funded job (${r.ok ? r.rows.length + " row" : r.err})`);
  console.log(`${landed(seat) ? "GAP   " : "closed"} the second account then has UPDATE on that job (${seat.ok ? seat.rows.length + " row" : seat.err})`);
  if (!landed(r) || !landed(seat)) { fail = true; console.log("FAIL: the gap did not reproduce"); }
  await db.close();
}
{
  let bad;
  try { const db = await fresh([MIG, MIG, MIG]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  console.log("\n== AFTER (migration applied 3x)");
  if (bad.length) { fail = true; console.log("FAIL\n   " + bad.join("\n   ")); } else console.log("all expectations hold (green)");
}
const mutate = (from, to) => { if (!MIG.includes(from)) throw new Error(`anchor missing: ${from.slice(0, 50)}`); return MIG.replace(from, to); };
const broken = [
  ["hired jobs not covered", mutate("AND (OLD.helper_id IS NOT NULL OR OLD.status::text <> 'open') THEN", "AND (OLD.status::text <> 'open') THEN")],
  ["non-open jobs not covered", mutate("AND (OLD.helper_id IS NOT NULL OR OLD.status::text <> 'open') THEN", "AND (OLD.helper_id IS NOT NULL) THEN")],
  ["same offeree back to pending not covered", mutate("          OR NEW.direct_offer_status IS DISTINCT FROM OLD.direct_offer_status)", "          )")],
  ["server exemption missing", mutate("  IF public.is_server_context() THEN\n    RETURN NEW;\n  END IF;", "")],
  ["refuses every offer change", mutate("  IF NEW.direct_offer_status = 'pending'\n", "  IF true OR NEW.direct_offer_status = 'pending'\n")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  let bad;
  try { const db = await fresh([sql]); bad = await expectations(db); await db.close(); } catch (e) { bad = [`apply error: ${e.message}`]; }
  if (!bad.length) { fail = true; console.log(`NOT CAUGHT: ${label}`); } else console.log(`caught: ${label}\n   ${bad[0]}`);
}
console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
