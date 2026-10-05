#!/usr/bin/env node
/**
 * PGlite proof for 20261005064123_refund_claim_put_back_is_not_a_new_payment
 * (Q1319; lh-money-escrow review of Q1290, 2026-10-05).
 *
 *   node src/test/pglite/refundClaimPutBackIsNotANewPayment.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/refundClaimPutBackIsNotANewPayment.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the columns notify_on_payment_escrowed() reads, the live trigger
 * (AFTER UPDATE ON jobs, no WHEN), and the function as the NEWEST migration
 * before this one defines it (20261003184911, equal to the live body, md5
 * f88f50a74c793756e1538e0e8b660bbf read 2026-10-05). Then the new migration
 * is applied 3x and every transition in and out of a 'cancelling' claim is
 * driven through a real UPDATE, counting the notices it writes.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = "20261005064123_refund_claim_put_back_is_not_a_new_payment.sql";
const FIX = readFileSync(`${MIG_DIR}${NEW}`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

/** notify_on_payment_escrowed as the newest migration before this one defines it (any dollar tag). */
function priorDefinition() {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < NEW).sort();
  let body = null;
  for (const f of files) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const at = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed(");
    if (at < 0) continue;
    const tag = sql.slice(at).match(/AS (\$[A-Za-z_]*\$)/)[1];
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    body = sql.slice(at, close + tag.length) + ";";
  }
  return body;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "11111111-0000-0000-0000-000000000001";
const HELPR = "11111111-0000-0000-0000-000000000002";
const MEMBER_A = "11111111-0000-0000-0000-00000000000a";
const MEMBER_B = "11111111-0000-0000-0000-00000000000b";
const uuid = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  payment_status text, is_group_job boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, financial_alerts boolean);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text,
  message text, type text, link text, job_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE OR REPLACE FUNCTION public.log_notification(_u uuid, _c text, _ch text, _s text, _t text, _j uuid)
  RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
`);
const prior = priorDefinition();
check("found the prior definition (20261003184911)", !!prior && prior.includes("'chargeback'"));
await db.exec(prior);
await db.exec(`CREATE TRIGGER trg_notify_payment_escrowed AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();`);

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(FIX);
  check("the migration applies 3x verbatim (replay-safe)", true);
}

const notices = async (job) =>
  (await db.query(`SELECT user_id, title FROM public.notifications WHERE link LIKE '%${job}' OR job_id = '${job}' ORDER BY title, user_id`)).rows;

/** One job walked through `states` by real UPDATEs; the notices written after the first. */
async function walkStates(n, states, { crew = false } = {}) {
  const job = uuid(n);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, helper_id, title, payment_status, is_group_job)
    VALUES ('${job}', '${POSTER}', ${crew ? "NULL" : `'${HELPR}'`}, 'Job ${n}', '${states[0]}', ${crew});`);
  if (crew) {
    await db.exec(`INSERT INTO public.group_job_helpers VALUES ('${job}', '${MEMBER_A}'), ('${job}', '${MEMBER_B}');`);
  }
  for (const s of states.slice(1)) await db.exec(`UPDATE public.jobs SET payment_status = '${s}' WHERE id = '${job}'`);
  return notices(job);
}

// ── A claim put back is not a new payment ────────────────────────────────
{
  const got = await walkStates(1, ["escrow", "cancelling", "escrow"]);
  check("escrow -> cancelling -> escrow (a put-back) writes NO 'Payment secured' / 'Job funded'", got.length === 0, JSON.stringify(got));
}
{
  const got = await walkStates(2, ["released", "cancelling", "released"]);
  check("released -> cancelling -> released (an admin refund refused) writes NO 'Payout released'", got.length === 0, JSON.stringify(got));
}
{
  const got = await walkStates(3, ["released", "cancelling", "released"], { crew: true });
  check("a crew's released claim put back writes NO member 'Payout released'", got.length === 0, JSON.stringify(got));
}
{
  const got = await walkStates(4, ["payout_pending", "cancelling", "payout_pending"]);
  check("payout_pending -> cancelling -> payout_pending writes nothing", got.length === 0, JSON.stringify(got));
}

// ── Every real payment transition notifies exactly as before ─────────────
{
  const got = await walkStates(10, ["unpaid", "escrow"]);
  check("checkout unpaid -> escrow: the poster's 'Payment secured' and the Helpr's 'Job funded'",
    got.length === 2 && got.some((r) => r.title === "Payment secured in escrow" && r.user_id === POSTER)
      && got.some((r) => r.title === "Job funded" && r.user_id === HELPR), JSON.stringify(got));
}
{
  const got = await walkStates(11, ["payout_pending", "released"]);
  check("payout payout_pending -> released: the Helpr's 'Payout released'",
    got.length === 1 && got[0].title === "Payout released" && got[0].user_id === HELPR, JSON.stringify(got));
}
{
  const got = await walkStates(12, ["payout_pending", "released"], { crew: true });
  check("crew fan-out payout_pending -> released: each member's 'Payout released'",
    got.length === 2 && got.every((r) => r.title === "Payout released"), JSON.stringify(got));
}
{
  const got = await walkStates(13, ["chargeback", "escrow"]);
  check("chargeback -> escrow still writes nothing (20261003184911 kept)", got.length === 0, JSON.stringify(got));
}
{
  const got = await walkStates(14, ["escrow", "cancelling", "refunded"]);
  check("a claim that ends refunded writes no payment notice", got.length === 0, JSON.stringify(got));
}

// ── Grants unchanged: service_role only ──────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const ok = MODE === "skip" ? true : !(await db.query(
    `SELECT has_function_privilege('${role}', 'public.notify_on_payment_escrowed()', 'EXECUTE') AS x`,
  )).rows[0].x;
  check(`${role} cannot execute notify_on_payment_escrowed`, ok);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
