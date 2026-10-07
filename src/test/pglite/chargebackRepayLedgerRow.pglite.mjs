#!/usr/bin/env node
/**
 * PGlite proof for 20261007012447_chargeback_repay_row_beside_reversed
 * (docs/OPEN.md Q805 (5)): a WON dispute's re-payment row lands beside the
 * reversed original, and the index still allows one live payout per job/helper.
 *
 *   node src/test/pglite/chargebackRepayLedgerRow.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/chargebackRepayLedgerRow.pglite.mjs   # RED before
 *
 * The table is prod's columns and CHECKs (information_schema, 2026-10-07); the
 * index is created by 20260831190418's own block, verbatim.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  create table public.payout_transfers (
    id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    stripe_transfer_id text unique, stripe_account_id text, amount_cents int check (amount_cents > 0),
    currency text, platform_fee_cents int default 0 check (platform_fee_cents >= 0),
    status text check (status = any (array['pending','paid','failed','canceled','reversed','reversal_cleared'])),
    failure_reason text, initiated_by text, created_at timestamptz default now(), paid_at timestamptz,
    reversed_at timestamptz, metadata jsonb);
`);
const block = MIG("20260831190418_payout_transfer_claim_and_race_lock.sql");
const i = block.indexOf("-- ── 2. One live transfer per");
await db.exec(block.slice(i, block.indexOf("END;\n$$;", i) + "END;\n$$;".length));
if (!SKIP) for (let k = 0; k < 3; k++) await db.exec(MIG("20261007012447_chargeback_repay_row_beside_reversed.sql"));

const J = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", H = "11111111-1111-1111-1111-111111111111";
const ins = async (tr, status, meta = null) => {
  try {
    await db.query(`insert into public.payout_transfers (job_id, helper_id, stripe_transfer_id, amount_cents, status, metadata)
      values ($1, $2, $3, 800, $4, $5)`, [J, H, tr, status, meta]);
    return "ok";
  } catch (e) { return String(e.message).split("\n")[0]; }
};
check((await ins("tr_orig", "reversed")) === "ok", "[keep] the original transfer, reversed by the chargeback, is on the ledger");
const repay = await ins("tr_repay", "paid", JSON.stringify({ source: "chargeback-repay", dispute_id: "du_1" }));
check(repay === "ok", `[fix] the won dispute's re-payment row lands beside it (${repay})`);
const again = await ins("tr_repay", "paid", JSON.stringify({ source: "chargeback-repay", dispute_id: "du_1" }));
check(/duplicate key/.test(again), `[keep] the same re-payment transfer is one row (${again})`);
const second = await ins("tr_second", "paid");
check(/duplicate key/.test(second), `[keep] an ordinary second payout for the pair is still refused (${second})`);
const claim = await ins(null, "pending");
check(/duplicate key/.test(claim), `[keep] a new pending payout claim for the pair is still refused (${claim})`);
const idx = (await db.query(`select count(*)::int n from pg_indexes where indexname like 'payout_transfers_one_live_per_job_helper%'`)).rows[0].n;
check(idx === 1, `[keep] exactly one copy of the index (${idx})`);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
