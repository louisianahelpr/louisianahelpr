#!/usr/bin/env node
/**
 * PGlite proof for 20261031051513_instant_payout_fee_return (Jobs audit 54a: a Helpr
 * with an instant-payout fee still owed starts no new attempt, so no second fee).
 *
 *   node src/test/pglite/instantPayoutFeeReturn.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantPayoutFeeReturn.pglite.mjs # RED: before it
 *
 * The migration runs verbatim on the live table shape, read from prod 2026-10-31
 * (columns, the one-pending index, both CHECKs). pglite is not a dependency
 * (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261031051513_instant_payout_fee_return.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: before the migration (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const H = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.instant_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    helper_id uuid NOT NULL,
    gross_amount numeric NOT NULL,
    fee_amount numeric NOT NULL,
    net_amount numeric NOT NULL,
    stripe_payout_id text,
    status text NOT NULL DEFAULT 'pending',
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_instant_payouts_amounts_nonneg CHECK (gross_amount >= 0 AND fee_amount >= 0 AND net_amount >= 0),
    CONSTRAINT ck_instant_payouts_net_is_gross_minus_fee CHECK (round(net_amount, 2) = round(gross_amount - fee_amount, 2))
  );
  CREATE UNIQUE INDEX instant_payouts_one_pending_per_helper ON public.instant_payouts (helper_id) WHERE status = 'pending';
  INSERT INTO public.instant_payouts (helper_id, gross_amount, fee_amount, net_amount, status, stripe_payout_id)
    VALUES ('${OTHER}', 69, 2.07, 66.93, 'completed', 'po_live_row');
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const hasCol = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='instant_payouts' AND column_name='fee_state'`)).rows.length === 1;
check("the row can say what happened to its fee", hasCol);

/** One press at the database. Returns the SQLSTATE, or "ok". */
async function press(helper, feeState) {
  const cols = hasCol ? ", fee_state" : "";
  const vals = hasCol ? `, '${feeState}'` : "";
  try {
    await db.query(`INSERT INTO public.instant_payouts (helper_id, gross_amount, fee_amount, net_amount${cols})
      VALUES ('${helper}', 100, 3, 97${vals})`);
    return "ok";
  } catch (e) {
    return e.code ?? String(e);
  }
}
const end = (status, feeState) =>
  db.query(`UPDATE public.instant_payouts SET status='${status}'${hasCol ? `, fee_state='${feeState}'` : ""}
    WHERE helper_id='${H}' AND status='pending'`);

check("a first press opens an attempt", (await press(H, "attempting")) === "ok");
check("a second press during it is refused by the one-attempt index", (await press(H, "attempting")) === "23505");

await end("failed", "taken");
const afterFailed = await press(H, "attempting");
check("fail with the fee taken, then press again: refused by the database", afterFailed === "IP001", afterFailed);
if (afterFailed === "ok") await end("failed", "none");

const open = (await db.query(`SELECT count(*)::int n FROM public.instant_payouts WHERE helper_id='${H}' AND status='pending'`)).rows[0].n;
check("the refused press left no attempt behind", open === 0, `pending=${open}`);

await db.query(`UPDATE public.instant_payouts SET status='failed'${hasCol ? ", fee_state='attempting'" : ""} WHERE helper_id='${H}'`);
const unknown = await press(H, "attempting");
check("a stranded attempt whose fee is unknown also refuses a new one", unknown === "IP001", unknown);
if (unknown === "ok") await end("failed", "none");

if (hasCol) await db.query(`UPDATE public.instant_payouts SET fee_state='returned' WHERE helper_id='${H}'`);
check("the fee is back: the next press opens", (await press(H, "attempting")) === "ok");
await end("completed", "kept");
check("after a good payout the next press opens", (await press(H, "attempting")) === "ok");
await end("failed", "not_taken");
check("a fee never taken blocks nothing", (await press(H, "attempting")) === "ok");
await end("failed", "none");

check("another Helpr is never blocked by this one's fee", (await (async () => {
  await db.query(`INSERT INTO public.instant_payouts (helper_id, gross_amount, fee_amount, net_amount, status${hasCol ? ", fee_state" : ""})
    VALUES ('${H}', 100, 3, 97, 'failed'${hasCol ? ", 'taken'" : ""})`);
  return press(OTHER, "attempting");
})()) === "ok");

if (hasCol) {
  const live = (await db.query(`SELECT fee_state FROM public.instant_payouts WHERE stripe_payout_id='po_live_row'`)).rows[0];
  check("the existing live row reads as owing nothing", live.fee_state === "none", live.fee_state);
  let refused = false;
  try { await db.query(`UPDATE public.instant_payouts SET fee_state='whatever' WHERE stripe_payout_id='po_live_row'`); }
  catch { refused = true; }
  check("fee_state takes only the known values", refused);
  const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname='refuse_instant_payout_while_fee_owed'`)).rows[0]?.a ?? "";
  check("the trigger function is not open to anon or authenticated", !/(anon|authenticated)=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
} else {
  check("the existing live row reads as owing nothing", false, "no column");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
