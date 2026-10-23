#!/usr/bin/env node
/**
 * PGlite proof for 20261023151810_fee_transfer_failures_are_remembered (Q2356).
 *
 *   node src/test/pglite/feeTransferFailuresRemembered.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/feeTransferFailuresRemembered.pglite.mjs  # RED
 *
 * Proves, with the migration applied 3 times: both fee ledgers gain failed_transfer_ids (default empty);
 * note_failed_fee_transfer remembers a transfer once per row (a redelivered webhook adds nothing), marks a
 * crew share failed only when the failed transfer is its current one (or it has none), never touches a
 * share already paid by a LATER transfer, refuses a bad kind / NULL / blank argument, returns NULL for an
 * unknown row, and only the service role may call it.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite. Tables are the prod shapes the
 * migrations define (20260925154606 crew shares; cancellation_fee_transfers' columns as types.ts lists).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const NEW_FILE = "20261023151810_fee_transfer_failures_are_remembered.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const skip = process.env.NEW_MIGRATION === "skip";
const db = new PGlite();
let pass = 0;
let fail = 0;
const ok = (c, l) => { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const q = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const refused = (r, re) => !Array.isArray(r) && re.test(r?.error ?? "");
async function as(role, sql) {
  try { await db.exec(`SET ROLE ${role};`); return (await db.query(sql)).rows; }
  catch (e) { return { error: String(e.message ?? e) }; }
  finally { await db.exec(`RESET ROLE;`); }
}

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.cancellation_fee_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  helper_id uuid, fee_amount numeric NOT NULL, commission_percent numeric NOT NULL, platform_cut numeric NOT NULL,
  helper_amount numeric NOT NULL, status text NOT NULL DEFAULT 'pending', stripe_transfer_id text, failure_reason text,
  paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.crew_cancellation_fee_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  helper_id uuid, committed boolean NOT NULL, share_basis_cents integer NOT NULL, fee_percent integer NOT NULL,
  share_amount numeric(10,2) NOT NULL, status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'void')),
  stripe_transfer_id text, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
  CONSTRAINT crew_cancellation_fee_shares_paid_has_transfer CHECK (status <> 'paid' OR stripe_transfer_id IS NOT NULL));
GRANT ALL ON public.cancellation_fee_transfers, public.crew_cancellation_fee_shares TO service_role;
`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${NEW_FILE}`, import.meta.url), "utf8"));

const FEE = "cccccccc-0000-0000-0000-000000000001";
const SH_PAID = "dddddddd-0000-0000-0000-000000000001";
const SH_LATER = "dddddddd-0000-0000-0000-000000000002";
const SH_NONE = "dddddddd-0000-0000-0000-000000000003";
const JOB = "eeeeeeee-0000-0000-0000-000000000001";
await q(`INSERT INTO public.cancellation_fee_transfers (id, job_id, fee_amount, commission_percent, platform_cut, helper_amount, status, stripe_transfer_id)
  VALUES ('${FEE}', '${JOB}', 150, 12, 18, 132, 'failed', 'tr_a')`);
await q(`INSERT INTO public.crew_cancellation_fee_shares (id, job_id, committed, share_basis_cents, fee_percent, share_amount, status, stripe_transfer_id) VALUES
  ('${SH_PAID}', '${JOB}', true, 10000, 50, 50, 'paid', 'tr_x'),
  ('${SH_LATER}', '${JOB}', true, 10000, 50, 50, 'paid', 'tr_new'),
  ('${SH_NONE}', '${JOB}', true, 10000, 50, 50, 'pending', NULL)`);

const fee = async () => (await q(`SELECT * FROM public.cancellation_fee_transfers WHERE id = '${FEE}'`))[0] ?? {};
const share = async (id) => (await q(`SELECT * FROM public.crew_cancellation_fee_shares WHERE id = '${id}'`))[0] ?? {};
const note = (kind, row, tr) => as("service_role", `SELECT public.note_failed_fee_transfer('${kind}', '${row}', '${tr}', 'closed') AS r`);

ok(Array.isArray((await fee()).failed_transfer_ids) && (await fee()).failed_transfer_ids.length === 0, "both ledgers gain failed_transfer_ids, empty by default");
ok((await note("fee", FEE, "tr_a"))[0]?.r === FEE, "a failed fee transfer is remembered on its row (the row id is returned)");
await note("fee", FEE, "tr_a");
ok(JSON.stringify((await fee()).failed_transfer_ids) === '["tr_a"]', "  a redelivered webhook remembers it once");
await note("fee", FEE, "tr_b");
ok(JSON.stringify((await fee()).failed_transfer_ids) === '["tr_a","tr_b"]', "  a second failure is added, the first kept (an older failed transfer is never mistaken for a payment)");
ok((await fee()).status === "failed", "  the fee row's own status is the webhook's settle step's, unchanged here");

await note("share", SH_PAID, "tr_x");
const s1 = await share(SH_PAID);
ok(s1.status === "failed" && JSON.stringify(s1.failed_transfer_ids) === '["tr_x"]', "a crew share whose current transfer failed is marked failed and remembers it (the share retry then pays it)");
await note("share", SH_LATER, "tr_old");
const s2 = await share(SH_LATER);
ok(s2.status === "paid" && JSON.stringify(s2.failed_transfer_ids) === '["tr_old"]', "  an OLD transfer failing never un-pays a share a later transfer paid");
await note("share", SH_NONE, "tr_y");
ok((await share(SH_NONE)).status === "failed", "  a share with no transfer on record is marked failed");

ok(Array.isArray(await note("fee", "cccccccc-0000-0000-0000-00000000dead", "tr_z")) && (await note("fee", "cccccccc-0000-0000-0000-00000000dead", "tr_z"))[0]?.r === null,
  "an unknown row answers NULL (the webhook pages that nothing matched)");
ok(refused(await note("other", FEE, "tr_a"), /invalid_argument/), "an unknown kind is refused");
ok(refused(await as("service_role", `SELECT public.note_failed_fee_transfer('fee', '${FEE}', '  ', 'x')`), /invalid_argument/), "a blank transfer id is refused");
ok(refused(await as("service_role", `SELECT public.note_failed_fee_transfer('fee', NULL, 'tr_a', 'x')`), /invalid_argument/), "a NULL row is refused");
ok(refused(await as("authenticated", `SELECT public.note_failed_fee_transfer('fee', '${FEE}', 'tr_q', 'x')`), /permission denied/), "a member cannot call it");
ok(refused(await as("anon", `SELECT public.note_failed_fee_transfer('fee', '${FEE}', 'tr_q', 'x')`), /permission denied/), "anon cannot call it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
