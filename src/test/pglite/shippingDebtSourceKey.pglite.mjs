#!/usr/bin/env node
/**
 * PGlite proof for 20261102043018_shipping_debt_source_key (Q2259 S6 part 2a; shipping-draft 5.3 "Debts", money
 * review fix 4): declutter_seller_fee_debts gets one key, (source_kind, source_ref) UNIQUE. Existing refund and raise
 * debts are labelled 'refund_card_fee' / 'raise_card_fee' (amounts untouched); the old writers' INSERT ... ON CONFLICT
 * (refund_id) still works and fills the pair; a shipping debt ('ship_void_rejected' etc.) names no source column and
 * is booked once per source; a pair that disagrees with its column, a shipping kind with a refund column, an unknown
 * kind and a changed pair are all refused; the seller still reads only the five granted columns (Supabase's default
 * table grants emulated). Applied 3x.
 *
 *   node src/test/pglite/shippingDebtSourceKey.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingDebtSourceKey.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102043018_shipping_debt_source_key.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, me, USERS } = await buildHandoverWorld();
const { SELLER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);
const q = async (s) => { const r = await svc(s); return Array.isArray(r) ? (r[0] ?? null) : r; };
const U = (p, n) => `${p}-0000-0000-0000-${String(n).padStart(12, "0")}`;
const R = (n) => U("d0d0d0d0", n); // refunds
const X = (n) => U("e0e0e0e0", n); // raises
const S = (n) => U("f0f0f0f0", n); // shipments (no FK)

// Refund and raise rows to point at (FK checks off only while planting them; the orders/tasks they name are not
// part of this proof).
const plant = async (sql) => run(`SET session_replication_role = replica; ${sql}; SET session_replication_role = origin;`);
for (let n = 1; n <= 6; n++) {
  const e = await plant(`INSERT INTO public.declutter_refunds (id, stripe_payment_intent_id, reason, fee_policy, paid_cents,
    card_fee_cents, refund_cents) VALUES ('${R(n)}', 'pi_debtkey_${n}', 'seller_backed_out', 'full_seller_pays_fee', 1000, 59, 1000)`);
  ok(!e, `refund ${n} planted${e ? `: ${e.error}` : ""}`);
}
const e1 = await plant(`INSERT INTO public.declutter_delivery_raises (id, task_id, raise_cents, card_fee_cents, total_cents)
  VALUES ('${X(1)}', gen_random_uuid(), 500, 45, 545)`);
ok(!e1, `raise planted${e1 ? `: ${e1.error}` : ""}`);

// Debts that exist BEFORE the migration (prod has refund debts; one partly paid).
ok(!(await run(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(1)}', 59, 20)`))?.error, "a pre-existing refund debt (59, 20 left)");
ok(!(await run(`INSERT INTO public.declutter_seller_fee_debts (seller_id, raise_id, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${X(1)}', 45, 45)`))?.error, "a pre-existing raise debt");

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
  // Supabase's default: every new table is readable and writable by anon and authenticated unless revoked.
  await run(`GRANT ALL ON TABLE public.declutter_seller_fee_debts TO anon, authenticated`);
  const r = await run(sql);
  ok(!r?.error, `the migration applies again after the default grant${r?.error ? `: ${r.error}` : ""}`);
}

// 1. Backfill labels, never moves money.
const old1 = await q(`SELECT source_kind, source_ref, amount_cents, remaining_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${R(1)}'`);
ok(old1?.source_kind === "refund_card_fee" && old1?.source_ref === R(1) && old1?.amount_cents === 59 && old1?.remaining_cents === 20,
  `the old refund debt is labelled refund_card_fee, amounts untouched (${short(old1)})`);
const old2 = await q(`SELECT source_kind, source_ref FROM public.declutter_seller_fee_debts WHERE raise_id = '${X(1)}'`);
ok(old2?.source_kind === "raise_card_fee" && old2?.source_ref === X(1), `the old raise debt is labelled raise_card_fee (${short(old2)})`);
const nulls = await q(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts WHERE source_kind IS NULL OR source_ref IS NULL`);
ok(nulls?.n === 0, `no debt is left unlabelled (${short(nulls)})`);
const nn = await q(`SELECT bool_and(is_nullable = 'NO') AS b FROM information_schema.columns WHERE table_schema = 'public'
  AND table_name = 'declutter_seller_fee_debts' AND column_name IN ('source_kind', 'source_ref')`);
ok(nn?.b === true, `source_kind and source_ref are NOT NULL (${short(nn)})`);

// 2. The old writers' statement shape keeps working and fills the pair.
const oldWriter = (n, amt) => svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(n)}', ${amt}, ${amt}) ON CONFLICT (refund_id) DO NOTHING RETURNING source_kind, source_ref`);
const w1 = await oldWriter(2, 59);
ok(Array.isArray(w1) && w1[0]?.source_kind === "refund_card_fee" && w1[0]?.source_ref === R(2),
  `declutter_record_refund's INSERT ... ON CONFLICT (refund_id) fills the pair (${short(w1)})`);
const w2 = await oldWriter(2, 59);
ok(Array.isArray(w2) && w2.length === 0, `its replay books nothing (${short(w2)})`);
const up = await svc(`INSERT INTO public.declutter_seller_fee_debts AS d (seller_id, refund_id, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(2)}', 30, 30) ON CONFLICT (refund_id) DO UPDATE
  SET amount_cents = d.amount_cents + EXCLUDED.amount_cents, remaining_cents = d.remaining_cents + EXCLUDED.remaining_cents
  RETURNING amount_cents, source_kind`);
ok(Array.isArray(up) && up[0]?.amount_cents === 89 && up[0]?.source_kind === "refund_card_fee",
  `declutter_setup_job_fee_debt's ON CONFLICT DO UPDATE still adds to the same debt (${short(up)})`);

// 3. A shipping debt: no source column, one per source.
const ship = (kind, ref, amt = 812, conflict = "") => svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref,
  amount_cents, remaining_cents) VALUES ('${SELLER2}', '${kind}', '${ref}', ${amt}, ${amt}) ${conflict} RETURNING id`);
const s1 = await ship("ship_void_rejected", S(1));
ok(Array.isArray(s1) && s1.length === 1, `a ship_void_rejected debt is booked (${short(s1)})`);
const s2 = await ship("ship_void_rejected", S(1));
ok(s2?.code === "23505", `a second one for the same shipment is refused, unique (${short(s2)})`);
const s3 = await ship("ship_void_rejected", S(1), 812, "ON CONFLICT (source_kind, source_ref) DO NOTHING");
ok(Array.isArray(s3) && s3.length === 0, `the new writers' ON CONFLICT (source_kind, source_ref) books nothing on replay (${short(s3)})`);
for (const k of ["ship_label", "ship_adjustment", "ship_hazmat_fee"]) {
  const r = await ship(k, S(1));
  ok(Array.isArray(r) && r.length === 1, `${k} for the same shipment is its own debt (${short(r)})`);
}

// 4. Refusals.
const bad = await ship("ship_postage_misc", S(2));
ok(bad?.code === "23514", `an unknown kind is refused (${short(bad)})`);
const mix = await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(3)}', 'ship_label', '${S(3)}', 100, 100)`);
ok(mix?.code === "23514", `a shipping kind with a refund column is refused (${short(mix)})`);
const wrongRef = await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(4)}', 'refund_card_fee', '${R(5)}', 100, 100)`);
ok(wrongRef?.code === "23514", `a refund debt whose source_ref is another refund is refused (${short(wrongRef)})`);
// The CHECK holds on its own too (a restore or replica-mode load runs no triggers).
const noTrig = async (sql) => { const e = await run(`SET session_replication_role = replica; ${sql}`); await run(`SET session_replication_role = origin`); return e; };
const mixC = await noTrig(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(3)}', 'ship_label', '${S(4)}', 100, 100)`);
ok(mixC?.code === "23514", `with triggers off, the CHECK still refuses a shipping kind with a refund column (${short(mixC)})`);
const refC = await noTrig(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', '${R(4)}', 'refund_card_fee', '${R(5)}', 100, 100)`);
ok(refC?.code === "23514", `with triggers off, the CHECK still refuses a refund debt pointing at another refund (${short(refC)})`);
const none = await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents) VALUES ('${SELLER2}', 100, 100)`);
ok(!!none?.error, `a debt with no source at all is refused (${short(none)})`);
const move = await svc(`UPDATE public.declutter_seller_fee_debts SET source_ref = '${S(9)}' WHERE source_kind = 'ship_label' AND source_ref = '${S(1)}'`);
ok(move?.code === "23514", `a debt's source cannot be changed (${short(move)})`);
const swap = await svc(`UPDATE public.declutter_seller_fee_debts SET refund_id = '${R(6)}' WHERE refund_id = '${R(2)}'`);
ok(swap?.code === "23514", `a refund debt cannot be moved to another refund (${short(swap)})`);
const pay = await svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE refund_id = '${R(2)}' RETURNING remaining_cents`);
ok(Array.isArray(pay) && pay[0]?.remaining_cents === 0, `paying a debt off (declutter_consume_fee_debt's UPDATE) still works (${short(pay)})`);

// 5. Grants: the seller reads the five columns, never source_ref; anon nothing; nobody but service role writes.
const mine = await me(SELLER2, `SELECT id, amount_cents, remaining_cents FROM public.declutter_seller_fee_debts`);
ok(Array.isArray(mine) && mine.length >= 3, `the seller still reads their own debts (${short(mine)?.slice(0, 80)})`);
const peek = await me(SELLER2, `SELECT source_ref FROM public.declutter_seller_fee_debts`);
ok(peek?.code === "42501", `the seller cannot read source_ref (${short(peek)})`);
const anon = await me(null, `SELECT id FROM public.declutter_seller_fee_debts`);
ok(anon?.code === "42501", `anon reads nothing (${short(anon)})`);
const forge = await me(SELLER2, `INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', 'ship_label', '${S(7)}', 1, 1)`);
ok(forge?.code === "42501", `a member cannot write a debt (${short(forge)})`);
const fx = await q(`SELECT has_function_privilege('authenticated', 'public.declutter_fee_debt_source()', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.declutter_fee_debt_source()', 'EXECUTE') AS n`);
ok(fx?.a === false && fx?.n === false, `the trigger function is not executable by members (${short(fx)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
