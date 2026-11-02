#!/usr/bin/env node
/**
 * Q2127 (PGlite proof for 20261102081647_quote_hire_catches_query_canceled): a statement_timeout (query_canceled,
 * SQLSTATE 57014) during the quote hire no longer rolls back the webhook's escrow write. The payment write lands, the
 * job stays unhired with its direct offer pending, and error_logs records sqlstate 57014.
 *
 *   node src/test/pglite/quoteHireCatchesQueryCanceled.pglite.mjs                       # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/quoteHireCatchesQueryCanceled.pglite.mjs    # RED: the escrow write aborts
 *   MUTANT=<name> node src/test/pglite/quoteHireCatchesQueryCanceled.pglite.mjs         # a planted defect: must FAIL
 *
 * Real: quote_job_funded_hires_quoter (newest definition: this file, or the one before it with skip), its trigger
 * as 20261018155222 creates it. Stubbed, said so: the tables reduced to the columns read; job_payment_is_funded,
 * quote_job_offered_to_quoter, direct_accept_block_reason, helper_accept_block_reason, are_users_blocked,
 * job_offer_cutoff are fixed stand-ins; quote_notify_to records calls; complete_direct_offer_accept is planted to
 * RAISE SQLSTATE 57014 (PGlite runs no statement timer, measured: SET statement_timeout = '100ms' then
 * SELECT pg_sleep(1) returned after 1000 ms with no error), or to answer a hire for the control.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102081647_quote_hire_catches_query_canceled.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The catch reverts to WHEN OTHERS alone (query_canceled is not caught).
  othersOnly: ["  EXCEPTION WHEN OTHERS OR query_canceled THEN", "  EXCEPTION WHEN OTHERS THEN"],
  // The restate leaves Supabase's default EXECUTE grant on.
  openGrant: ["REVOKE ALL ON FUNCTION public.quote_job_funded_hires_quoter() FROM PUBLIC, anon, authenticated;", ""],
  // The restate drops the not-hired record (the throw would be silent).
  noRecord: ["              'Paid quote job did not hire its quoter automatically',", "              NULL,"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
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
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const POSTER = "cdcdcdcd-0000-0000-0000-000000000001", QUOTER = "cdcdcdcd-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, status text DEFAULT 'open',
  payment_status text DEFAULT 'unpaid', stripe_payment_intent_id text, offered_to_helper_id uuid, helper_id uuid,
  direct_offer_status text, direct_offer_expires_at timestamptz, date_needed date, start_time time, is_seed boolean DEFAULT false);
CREATE TABLE public.job_quote_requests (job_id uuid, status text, title text);
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid);
CREATE TABLE public.error_logs (severity text, message text NOT NULL, url text, tags jsonb, context jsonb);
CREATE TABLE public.notices (user_id uuid, title text);
CREATE TABLE public.hire_mode (mode text);
INSERT INTO public.hire_mode VALUES ('cancel');
CREATE FUNCTION public.job_payment_is_funded(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p IN ('escrow', 'payout_pending', 'released') $$;
CREATE FUNCTION public.quote_job_offered_to_quoter(j uuid, h uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT h IS NOT NULL $$;
CREATE FUNCTION public.direct_accept_block_reason(j uuid, h uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.helper_accept_block_reason(h uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.quote_notify_to(p_user uuid, p_title text, p_msg text, p_other uuid, p_email boolean, p_req uuid, p_job uuid, p_x boolean)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title) $$;
CREATE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid) RETURNS jsonb LANGUAGE plpgsql AS $p$
BEGIN
  IF (SELECT mode FROM public.hire_mode) = 'cancel' THEN
    RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = '57014';
  END IF;
  UPDATE public.jobs SET helper_id = p_helper, status = 'accepted', direct_offer_status = 'accepted' WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true);
END $p$;
`);
let planted = false;
const plant = (sql) => {
  if (!MUTANT) return sql;
  const [find, repl] = MUTANTS[MUTANT];
  if (!sql.includes(find)) return sql;
  planted = true;
  return sql.replace(find, repl);
};
if (skip) {
  await db.exec(definitionBefore("quote_job_funded_hires_quoter", THIS));
  await db.exec(`REVOKE ALL ON FUNCTION public.quote_job_funded_hires_quoter() FROM PUBLIC, anon, authenticated;`);
} else {
  const mig = plant(readFileSync(MIG_DIR + THIS, "utf8"));
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
if (MUTANT && !planted) throw new Error(`mutant ${MUTANT} did not apply`);
// The trigger exactly as 20261018155222 creates it.
await db.exec(`CREATE TRIGGER trg_quote_job_funded_hires_quoter
  AFTER UPDATE OF payment_status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.offered_to_helper_id IS NOT NULL AND NEW.helper_id IS NULL)
  EXECUTE FUNCTION public.quote_job_funded_hires_quoter();`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
async function quoteJob() {
  const id = (await q(`INSERT INTO public.jobs (customer_id, offered_to_helper_id, direct_offer_status, date_needed)
    VALUES ($1, $2, 'pending', (now() + interval '5 days')::date) RETURNING id`, [POSTER, QUOTER]))[0].id;
  await q(`INSERT INTO public.job_quote_requests VALUES ($1, 'agreed', 'Fence repair')`, [id]);
  return id;
}
const fund = async (id, pi) => {
  try { await q(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = $2 WHERE id = $1`, [id, pi]); return null; }
  catch (e) { return `${e.code ?? ""} ${e.message}`; }
};

// (a) The hire times out: the escrow write still lands, nothing is hired, and it is logged with 57014.
const a = await quoteJob();
const aErr = await fund(a, "pi_q2127_a");
check(aErr === null, "(a) a statement_timeout in the hire does not abort the webhook's escrow write", aErr ?? "");
const aJob = (await q(`SELECT payment_status, stripe_payment_intent_id, helper_id, direct_offer_status FROM public.jobs WHERE id = $1`, [a]))[0];
check(aJob.payment_status === "escrow" && aJob.stripe_payment_intent_id === "pi_q2127_a", "(a) the job is funded on this payment", JSON.stringify(aJob));
check(aJob.helper_id === null && aJob.direct_offer_status === "pending", "(a) nobody is hired; the direct offer stays pending", JSON.stringify(aJob));
const aLog = await q(`SELECT message, context->>'sqlstate' AS s FROM public.error_logs WHERE tags->>'job_id' = $1`, [a]);
check(aLog.length === 1 && aLog[0].s === "57014" && aLog[0].message === "Paid quote job did not hire its quoter automatically",
  "(a) error_logs records the not-hired job with sqlstate 57014", JSON.stringify(aLog));
const aTold = await q(`SELECT title FROM public.notices WHERE user_id = $1`, [QUOTER]);
check(aTold.length === 1 && aTold[0].title === "Accept to start", "(a) the quoter is told to accept by hand, once", JSON.stringify(aTold));

// (b) [control] A hire that works still hires and tells the quoter they are booked.
await q(`UPDATE public.hire_mode SET mode = 'ok'`);
const b = await quoteJob();
const bErr = await fund(b, "pi_q2127_b");
const bJob = (await q(`SELECT payment_status, helper_id FROM public.jobs WHERE id = $1`, [b]))[0];
const bTold = await q(`SELECT title FROM public.notices WHERE user_id = $1 AND title = 'You''re booked'`, [QUOTER]);
check(bErr === null && bJob.payment_status === "escrow" && bJob.helper_id === QUOTER && bTold.length === 1,
  "(b) [control] a hire that works hires the quoter and says so", `${bErr} ${JSON.stringify(bJob)} ${bTold.length}`);

const acl = (await q(`SELECT has_function_privilege('anon', 'public.quote_job_funded_hires_quoter()', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.quote_job_funded_hires_quoter()', 'EXECUTE') u`))[0];
check(!acl.a && !acl.u, `grants: anon ${acl.a} authenticated ${acl.u}`);

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
