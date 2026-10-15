#!/usr/bin/env node
/**
 * PGlite proof for 20261015034233_payout_batches_flat_fee (roadmap F3): the
 * admin payout-batch preview prices a flat-model job at 5% + 70c of the
 * per-Helpr budget + urgent share; a legacy job is unchanged.
 *
 *   node src/test/pglite/payoutBatchesFlatFee.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/payoutBatchesFlatFee.pglite.mjs # RED: the state on main
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000ad'::uuid $$;
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, helper_id uuid, budget numeric, urgent_fee numeric, is_group_job boolean DEFAULT false,
  helpers_needed int, helper_fee_percent numeric, helper_fee_flat_cents integer, status text DEFAULT 'completed',
  payment_status text DEFAULT 'escrow', poster_completed_at timestamptz DEFAULT now(), helper_completed_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid, full_name text, email text, stripe_account_id text);
CREATE TABLE public.disputes (job_id uuid, status text, execution_status text);
`);
await db.exec(read(`${MIGDIR}20261005172816_urgent_bonus_full_to_helpr_payout_batches.sql`));
const h = (n) => `20000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
  INSERT INTO public.profiles VALUES ('${h(1)}', 'flat', 'a@x', 'acct'), ('${h(2)}', 'flat-urgent', 'b@x', 'acct'), ('${h(3)}', 'legacy', 'c@x', 'acct');
  INSERT INTO public.jobs (id, helper_id, budget, urgent_fee, helper_fee_percent, helper_fee_flat_cents) VALUES
    ('30000000-0000-4000-8000-000000000001', '${h(1)}', 100, NULL, 5, 70),
    ('30000000-0000-4000-8000-000000000002', '${h(2)}', 100, 20, 5, 70),
    ('30000000-0000-4000-8000-000000000003', '${h(3)}', 100, NULL, 12, NULL);`);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(read(`${MIGDIR}20261015034233_payout_batches_flat_fee.sql`));
check("the migration applies three times", true);
const by = Object.fromEntries((await db.query(`SELECT helper_name, total_payout::text t FROM public.get_payout_batches()`)).rows.map((r) => [r.helper_name, r.t]));
check("$100 flat job previews $94.30", by.flat === "94.30", by.flat);
check("$100 + $20 urgent flat job previews $113.30 (5% of $120 + 70c)", by["flat-urgent"] === "113.30", by["flat-urgent"]);
check("$100 legacy job at 12% is unchanged ($88.00)", by.legacy === "88.00", by.legacy);
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.get_payout_batches()', 'EXECUTE') a`)).rows[0].a;
check("anon cannot execute it", acl === false, String(acl));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
