#!/usr/bin/env node
/**
 * PGlite proof for 20261019043252_helpr_fault_fee_true_up.
 *
 *   npx tsx src/test/pglite/helprFaultFeeTrueUp.pglite.mjs [--before]
 *
 * Loads the deduction table + take/restore from 20261019015303 verbatim, then
 * (unless --before) applies this migration 3x. With --before the checks T1-T4
 * must FAIL (the old take answers over the cap; the true-up does not exist);
 * exit 0 only when exactly those fail. Without it every check must PASS.
 *
 *   T1 a retried take whose cap shrank answers the cap and gives the rest back
 *   T2 the race: run A restores while run B's transfer withheld the fee;
 *      B's true-up books it again (the Helpr does not owe it twice)
 *   T3 an adopted orphan that withheld 0 while this run took 369: the true-up
 *      to 0 gives the 369 back
 *   T4 a true-up past what is still owed books what is owed and returns less
 *   T5 pin: a first take is unchanged (oldest ruling first, capped)
 *   T6 pin: service_role only (anon/authenticated cannot execute)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(DIR + "20261019015303_helpr_fault_payout_deduction.sql", "utf8");
const MIG = readFileSync(DIR + "20261019043252_helpr_fault_fee_true_up.sql", "utf8");
const BEFORE = process.argv.includes("--before");
const EXPECT_RED = new Set(["T1", "T2", "T3", "T4"]);

const results = new Map();
const check = (id, name, ok, detail = "") => {
  results.set(id, ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${name}${detail ? `  (${detail})` : ""}`);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = U(1), J1 = U(101), J2 = U(102), J3 = U(103), JP = U(201);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.job_helpr_fault_rulings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL UNIQUE, helper_id uuid,
  card_fee_cents integer, card_fee_remaining_cents integer, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_helpr_fault_fee_remaining CHECK (
    (card_fee_cents IS NULL AND card_fee_remaining_cents IS NULL)
    OR (card_fee_cents IS NOT NULL AND card_fee_remaining_cents BETWEEN 0 AND card_fee_cents)));
GRANT ALL ON TABLE public.job_helpr_fault_rulings, public.payout_transfers TO service_role;
`);
await db.exec(BASE);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIG);

const q1 = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const reset = async (rulings) => {
  await db.exec(`DELETE FROM public.job_helpr_fault_fee_deductions; DELETE FROM public.job_helpr_fault_rulings; DELETE FROM public.payout_transfers;`);
  let t = 0;
  for (const [job, cents] of rulings) {
    await db.query(
      `INSERT INTO public.job_helpr_fault_rulings (job_id, helper_id, card_fee_cents, card_fee_remaining_cents, created_at)
       VALUES ($1, $2, $3, $3, now() - make_interval(mins => $4))`,
      [job, H, cents, 100 - t++],
    );
  }
};
const owed = async () => Number((await q1(`SELECT COALESCE(sum(card_fee_remaining_cents),0) AS s FROM public.job_helpr_fault_rulings`)).s);
const booked = async (ref) => Number((await q1(`SELECT COALESCE(sum(deducted_cents),0) AS s FROM public.job_helpr_fault_fee_deductions WHERE payout_ref = $1`, [ref])).s);
const take = async (ref, max) => Number((await q1(`SELECT public.take_helpr_fault_fee($1, $2, $3) AS v`, [H, ref, max])).v);
const setW = async (ref, cents) => {
  try { return Number((await q1(`SELECT public.set_helpr_fault_fee_withheld($1, $2, $3) AS v`, [H, ref, cents])).v); }
  catch (e) { return `error: ${e.message}`; }
};
const REF = `job_payout_${JP}`;

// T1: first take 369 under cap 8700; the retry's cap is now 300.
await reset([[J1, 369]]);
await take(REF, 8700);
let r;
try { r = await take(REF, 300); } catch (e) { r = `error: ${e.message}`; }
check("T1", "a retry whose cap shrank answers the cap and gives the rest back",
  r === 300 && (await booked(REF)) === 300 && (await owed()) === 69, `answer ${r}, booked ${await booked(REF)}, owed ${await owed()}`);

// T2: B took 369 and sent it; A restored (no claim row yet); B's true-up.
await reset([[J1, 369]]);
await take(REF, 8700);
await db.query(`SELECT public.restore_helpr_fault_fee($1, $2)`, [H, JP]);
const afterRestore = await owed();
r = await setW(REF, 369);
check("T2", "the racing restore is undone once B's transfer withheld the fee",
  afterRestore === 369 && r === 369 && (await owed()) === 0 && (await booked(REF)) === 369, `restore left owed ${afterRestore}; true-up ${r}; owed ${await owed()}`);

// T3: this run took 369 but adopted an orphan that withheld 0.
await reset([[J1, 200], [J2, 169]]);
await take(REF, 8700);
r = await setW(REF, 0);
check("T3", "an adopted orphan that withheld 0 gives this run's take back",
  r === 0 && (await owed()) === 369 && (await booked(REF)) === 0, `true-up ${r}; owed ${await owed()}`);

// T4: withheld 500 but only 369 is owed.
await reset([[J1, 369]]);
r = await setW(REF, 500);
check("T4", "a true-up past the debt books what is owed and says so (less than asked)",
  r === 369 && (await owed()) === 0, `true-up ${r}`);

// T5: pin, first take oldest ruling first.
await reset([[J1, 200], [J2, 300], [J3, 50]]);
r = await take(REF, 350);
const firstLeft = Number((await q1(`SELECT card_fee_remaining_cents AS v FROM public.job_helpr_fault_rulings WHERE job_id = $1`, [J1])).v);
const secondLeft = Number((await q1(`SELECT card_fee_remaining_cents AS v FROM public.job_helpr_fault_rulings WHERE job_id = $1`, [J2])).v);
check("T5", "a first take is unchanged: oldest first, capped", r === 350 && firstLeft === 0 && secondLeft === 150, `take ${r}, left ${firstLeft}/${secondLeft}`);

// T6: grants.
if (!BEFORE) {
  const acl = (await q1(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'set_helpr_fault_fee_withheld'`)).a ?? "";
  check("T6", "set_helpr_fault_fee_withheld is service_role only",
    acl.includes("service_role=X") && !/(^|[{,])=X/.test(acl) && !acl.includes("anon=") && !acl.includes("authenticated="), acl);
} else {
  check("T6", "grants (skipped before)", true);
}

let ok;
if (BEFORE) {
  ok = [...results].every(([id, pass]) => (EXPECT_RED.has(id) ? !pass : pass));
  console.log(ok ? "BEFORE: exactly T1-T4 fail (as expected)" : "BEFORE: unexpected result");
} else {
  ok = [...results.values()].every(Boolean);
  console.log(ok ? "ALL PASS" : "FAILURES");
}
process.exit(ok ? 0 : 1);
