#!/usr/bin/env node
/**
 * PGlite proof for 20261102035736_declutter_seller_fault_sweep (Q1939): a Declutter seller-fault setup job the refund
 * trigger could not cancel is re-applied by the sweep (no fee, marked), while every job the apply leaves for an admin
 * (crew, committed Helpr on a buyer-reported no-show, money not at rest, done) and every job linked after the refund or
 * on a refund that is not the seller's fault is left alone; a failure is retried on the next run.
 *
 *   node src/test/pglite/declutterSellerFaultSweep.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerFaultSweep.pglite.mjs # RED: nothing re-applies A10
 *   MUTANT=<name> node src/test/pglite/declutterSellerFaultSweep.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_apply_seller_fault (its newest CREATE before this file), unchanged. Stubbed, said so: jobs,
 * declutter_refunds and declutter_order_jobs reduced to the columns it reads and writes; declutter_notify and
 * log_cron_defect record. Supabase's default anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102035736_declutter_seller_fault_sweep.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Any refund, not only the seller's fault.
  anyPolicy: ["     WHERE rf.fee_policy = 'full_seller_pays_fee' AND rf.order_id IS NOT NULL\n", "     WHERE rf.order_id IS NOT NULL\n"],
  // A link added after the refund is swept too.
  laterLinks: ["AND l.created_at <= rf.created_at", "AND true"],
  // A committed Helpr on a buyer-reported no-show is swept (the buyer is told "still booked" every run).
  committedNoShow: ["       AND NOT (rf.reason = 'seller_no_show' AND jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL)\n", ""],
  // A crew job is swept (the apply logs it every run).
  crew: ["       AND NOT COALESCE(jb.is_group_job, false)\n", ""],
  // A failure stops the sweep instead of being logged.
  noCatch: ["    EXCEPTION WHEN OTHERS THEN\n      PERFORM public.log_cron_defect('declutter_seller_fault_sweep'", "    EXCEPTION WHEN division_by_zero THEN\n      PERFORM public.log_cron_defect('declutter_seller_fault_sweep'"],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_seller_fault_sweep() FROM PUBLIC, anon, authenticated;", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), HELPR = U(2);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, status text NOT NULL, helper_id uuid, customer_id uuid,
  helper_completed_at timestamptz, is_group_job boolean, helper_confirmed_at timestamptz, payment_status text,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, reason text NOT NULL,
  fee_policy text NOT NULL CHECK (fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee')),
  is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_order_jobs (job_id uuid PRIMARY KEY, order_id uuid, purpose text NOT NULL CHECK (purpose IN ('setup')),
  seller_fault_refund_id uuid, seller_fault_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notices (user_id uuid, title text);
CREATE TABLE public.defects (fn text, ref text, msg text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title) $$;
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.defects VALUES (p_fn, p_ref, p_msg) $$;
`);
await db.exec(definitionBefore("declutter_apply_seller_fault", THIS));
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon, authenticated;`);

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
// Each case: its own order, refund and job. linkAfter: the link is newer than the refund.
const cases = {
  missed:   { n: 10, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "accepted", pay: "escrow", confirmed: false },
  crew:     { n: 20, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "accepted", pay: "escrow", crew: true },
  noShow:   { n: 30, reason: "seller_no_show", policy: "full_seller_pays_fee", status: "accepted", pay: "escrow", confirmed: true },
  later:    { n: 40, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "open", pay: "unpaid", linkAfter: true },
  marked:   { n: 50, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "accepted", pay: "escrow", marked: true },
  buyerSide:{ n: 60, reason: "buyer_backed_out", policy: "keep_card_fee", status: "accepted", pay: "escrow" },
  midCancel:{ n: 70, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "accepted", pay: "cancelling" },
  retry:    { n: 80, reason: "seller_backed_out", policy: "full_seller_pays_fee", status: "open", pay: "unpaid" },
};
for (const c of Object.values(cases)) {
  const order = U(c.n), refund = U(c.n + 1), job = U(c.n + 2);
  c.job = job; c.refund = refund;
  await q(`INSERT INTO public.jobs (id, title, status, helper_id, customer_id, is_group_job, helper_confirmed_at, payment_status)
    VALUES ($1, 'Set up the shelf', $2, CASE WHEN $2 = 'open' THEN NULL ELSE $3::uuid END, $4, $5, CASE WHEN $6 THEN now() END, $7)`,
    [job, c.status, HELPR, BUYER, !!c.crew, !!c.confirmed, c.pay]);
  await q(`INSERT INTO public.declutter_refunds (id, order_id, reason, fee_policy, created_at) VALUES ($1, $2, $3, $4, now() - interval '2 hours')`,
    [refund, order, c.reason, c.policy]);
  await q(`INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose, seller_fault_refund_id, created_at)
    VALUES ($1, $2, 'setup', CASE WHEN $3 THEN $4::uuid END, now() - CASE WHEN $5 THEN interval '1 hour' ELSE interval '3 hours' END)`,
    [job, order, !!c.marked, refund, !!c.linkAfter]);
}
// The retry case fails on the first run (a refused write), as the trigger's run did.
await q(`CREATE FUNCTION public.refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused write'; END $$`);
await q(`CREATE TRIGGER refuse BEFORE UPDATE ON public.jobs FOR EACH ROW WHEN (OLD.id = '${cases.retry.job}') EXECUTE FUNCTION public.refuse_write()`);

const status = async (c) => (await q(`SELECT j.status, l.seller_fault_refund_id m, j.cancellation_fee f FROM public.jobs j
  JOIN public.declutter_order_jobs l ON l.job_id = j.id WHERE j.id = $1`, [c.job]))[0];
const run = () => tryQ(`SELECT public.declutter_seller_fault_sweep() AS n`);

const noticesBefore = (await q(`SELECT count(*)::int n FROM public.notices`))[0].n;
const first = await run();
check(!first.error && first[0].n === 1, `[fix] the sweep cancels the one job the trigger missed (${JSON.stringify(first)})`);
const m = await status(cases.missed);
check(m.status === "cancelled" && m.m === cases.missed.refund && Number(m.f) === 0, `[fix] it is cancelled with no fee and marked (${JSON.stringify(m)})`);
for (const k of ["crew", "noShow", "later", "buyerSide", "midCancel"]) {
  const s = await status(cases[k]);
  check(s.status !== "cancelled" && s.m === null, `${k}: left as it is (${s.status})`);
}
check((await status(cases.marked)).status === "accepted", "an already-marked job is not touched again");
const ns = await q(`SELECT title FROM public.notices`);
check(!ns.some((x) => x.title === "Your Helpr job is still booked"), "the no-show buyer is not re-told 'still booked' by the sweep");
check(skip || ns.length - noticesBefore === 2, `[fix] the buyer and the Helpr of the cancelled job are told (${ns.length - noticesBefore})`);
const crewLogs = (await q(`SELECT count(*)::int n FROM public.defects WHERE ref = $1`, [cases.crew.job]))[0].n;
check(crewLogs === 0, "the crew job is not re-logged by the sweep");
check((await q(`SELECT count(*)::int n FROM public.defects WHERE fn LIKE 'declutter_seller_fault_sweep%' AND ref = $1`, [cases.buyerSide.refund]))[0].n === 0,
  "a refund that is not the seller's fault is never picked (no defect logged for it every run)");
check((await status(cases.retry)).status === "open", "the refused job is still open after the first run");
check(skip || (await q(`SELECT count(*)::int n FROM public.defects WHERE ref = $1`, [cases.retry.job]))[0].n === 1, "[fix] and its failure is logged");

// Next run, the write goes through: the job is cancelled then.
await q(`DROP TRIGGER refuse ON public.jobs`);
const second = await run();
check(!second.error && second[0].n === 1 && (await status(cases.retry)).status === "cancelled", `[fix] the next run cancels it (${JSON.stringify(second)})`);
const third = await run();
check(!third.error && third[0].n === 0, "a third run has nothing to do");

// A refund whose apply raises (its order list unreadable) is logged; the sweep goes on.
if (!skip) {
  await q(`CREATE OR REPLACE FUNCTION public.declutter_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
    RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
  const c = { n: 90 };
  await q(`INSERT INTO public.jobs (id, status, customer_id, payment_status) VALUES ($1, 'open', $2, 'unpaid')`, [U(92), BUYER]);
  await q(`INSERT INTO public.declutter_refunds (id, order_id, reason, fee_policy, created_at) VALUES ($1, $2, 'seller_backed_out', 'full_seller_pays_fee', now())`, [U(91), U(90)]);
  await q(`INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose, created_at) VALUES ($1, $2, 'setup', now() - interval '1 day')`, [U(92), U(90)]);
  void c;
  const r = await run();
  check(!r.error && r[0].n === 0, `[fix] an apply that raises does not stop the sweep (${JSON.stringify(r)})`);
  check((await q(`SELECT count(*)::int n FROM public.defects WHERE fn = 'declutter_seller_fault_sweep' AND ref = $1`, [U(91)]))[0].n === 1, "[fix] it is logged");
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_seller_fault_sweep()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_seller_fault_sweep()', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_seller_fault_sweep()', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a} authenticated ${acl.u} service ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
