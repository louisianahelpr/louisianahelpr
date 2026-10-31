#!/usr/bin/env node
/**
 * PGlite proof for 20261031184338_declutter_payout_attempts_readable (NIGHT-SELL-soldstates-4): a seller reads the try
 * count of their OWN payouts, so the card can say whether we are still trying; another member reads none of it.
 *
 *   node src/test/pglite/declutterPayoutAttemptsReadable.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPayoutAttemptsReadable.pglite.mjs  # RED: attempts refused
 *
 * World: roles and auth.uid(); declutter_payouts with the columns the grant names; the member grant and row policy
 * sliced verbatim from 20261015042253 (so an edit there is read here); then the new migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031184338_declutter_payout_attempts_readable.sql";
const BASE = readFileSync(`${MIG_DIR}20261015042253_declutter_slice4_handover_payout.sql`, "utf8");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const SELLER = "00000000-0000-4000-8000-00000000d001";
const OTHER = "00000000-0000-4000-8000-00000000d002";
const start = BASE.indexOf("ALTER TABLE public.declutter_payouts ENABLE ROW LEVEL SECURITY;");
const end = BASE.indexOf("FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));", start);
if (start < 0 || end < 0) throw new Error("declutter_payouts grant/policy not found in 20261015042253");
const GRANTS = BASE.slice(start, end) + "FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));";

const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, seller_id uuid NOT NULL,
    items_cents integer NOT NULL DEFAULT 0, debt_cents integer NOT NULL DEFAULT 0, amount_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz,
    attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), stripe_transfer_id text);
`);
await db.exec(GRANTS);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(readFileSync(`${MIG_DIR}${NEW_FILE}`, "utf8"));
await db.exec(`INSERT INTO public.declutter_payouts (order_id, seller_id, status, attempts, amount_cents, stripe_transfer_id) VALUES
  (gen_random_uuid(), '${SELLER}', 'failed', 12, 4000, 'tr_x'), (gen_random_uuid(), '${SELLER}', 'failed', 3, 2000, NULL),
  (gen_random_uuid(), '${OTHER}', 'failed', 5, 1000, NULL)`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
async function as(uid, sql) {
  try {
    await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const read = `SELECT order_id, items_cents, debt_cents, amount_cents, status, executed_at, attempts FROM public.declutter_payouts ORDER BY attempts DESC`;
const mine = await as(SELLER, read);
ok(Array.isArray(mine) && mine.map((r) => r.attempts).join(",") === "12,3", `the seller reads the try count of their own two payouts: ${JSON.stringify(Array.isArray(mine) ? mine.map((r) => r.attempts) : mine)}`);
const other = await as(OTHER, read);
ok(Array.isArray(other) && other.length === 1 && other[0].attempts === 5, "another seller reads only their own payout's count");
const anon = await as(null, `SELECT attempts FROM public.declutter_payouts`);
ok(!Array.isArray(anon) && /permission denied/.test(anon.error ?? ""), "anon reads nothing");
const transfer = await as(SELLER, `SELECT stripe_transfer_id FROM public.declutter_payouts`);
ok(!Array.isArray(transfer) && /permission denied/.test(transfer.error ?? ""), "the grant adds attempts only (stripe_transfer_id still refused)");
const next = await as(SELLER, `SELECT next_attempt_at FROM public.declutter_payouts`);
ok(!Array.isArray(next) && /permission denied/.test(next.error ?? ""), "next_attempt_at still refused");
const write = await as(SELLER, `UPDATE public.declutter_payouts SET attempts = 0`);
ok(!Array.isArray(write) && /permission denied/.test(write.error ?? ""), "the seller cannot change attempts");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
