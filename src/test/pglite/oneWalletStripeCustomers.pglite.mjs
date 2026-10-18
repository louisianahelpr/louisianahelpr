#!/usr/bin/env node
/**
 * PGlite proof for 20261018090700_one_wallet_stripe_customers (one wallet,
 * slice 1): one stored Stripe customer per member per mode, first writer wins,
 * service role only, Declutter saved cards backfilled.
 *
 *   node src/test/pglite/oneWalletStripeCustomers.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/oneWalletStripeCustomers.pglite.mjs   # RED: checks fail
 *
 * The migration is applied 3 times (replay safety). pglite is not a
 * dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = process.env.MIGRATION_PATH
  ?? join(REPO, "supabase/migrations/20261018090700_one_wallet_stripe_customers.sql");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";
const GHOST = "dddddddd-0000-0000-0000-000000000004";
const NOBODY = "eeeeeeee-0000-0000-0000-000000000005";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  -- Supabase grants new functions to anon/authenticated by default; model it.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  INSERT INTO auth.users VALUES ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${C}', 'c@x.test');
  -- prod shape of declutter_buyer_cards (20261014210518 + card_mode)
  CREATE TABLE public.declutter_buyer_cards (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_'),
    payment_method_id text NOT NULL CHECK (payment_method_id ~ '^pm_'),
    brand text, last4 text, card_mode text, saved_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, card_mode)
  VALUES ('${A}', 'cus_TESTa1', 'pm_1', 'test'), ('${C}', 'cus_bad!', 'pm_2', 'test');
  CREATE TABLE public.notifications (user_id uuid, title text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title) $$;
`);

const skip = process.env.NEW_MIGRATION === "skip";
const sql = readFileSync(MIGRATION, "utf8");
for (let i = 0; i < (skip ? 0 : 3); i++) await db.exec(sql);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svc = async (q) => { try { return (await db.query(q)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, uid, q) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(q)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const claim = (role, u, m, c) => as(role, null, `SELECT public.claim_stripe_customer('${u}', '${m}', '${c}') AS id`);

// 1. backfill: A's valid test card customer is stored; C's malformed one is not.
ok(one(await svc(`SELECT stripe_customer_id FROM public.stripe_customers WHERE user_id='${A}' AND wallet_mode='test'`)) === "cus_TESTa1",
  "backfill: Declutter saved card's customer stored in its mode");
ok(Number(one(await svc(`SELECT count(*) FROM public.stripe_customers WHERE user_id='${C}'`))) === 0,
  "backfill: a malformed customer id is skipped");
ok(Number(one(await svc(`SELECT count(*) FROM public.stripe_customers`))) === 1, "backfill: exactly one row after 3 applies");

// 2. claim: first writer wins, per mode.
ok(one(await claim("service_role", B, "live", "cus_LIVEb1")) === "cus_LIVEb1", "claim: first claim stores and returns it");
ok(one(await claim("service_role", B, "live", "cus_LIVEb2")) === "cus_LIVEb1", "claim: a second claim returns the stored one");
ok(one(await claim("service_role", B, "test", "cus_TESTb1")) === "cus_TESTb1", "claim: the other mode is its own row");
ok(one(await claim("service_role", A, "test", "cus_TESTa9")) === "cus_TESTa1", "claim: a backfilled row wins over a new claim");
ok(refused(await claim("service_role", C, "live", "cus_LIVEb1"), /duplicate key|unique/i),
  "claim: another member's customer id can never be bound");
ok(Number(one(await svc(`SELECT count(*) FROM public.stripe_customers WHERE stripe_customer_id='cus_LIVEb1'`))) === 1,
  "claim: the stolen-id attempt stored nothing");

// 3. input checks
ok(refused(await claim("service_role", B, "sandbox", "cus_X1"), /invalid_mode/), "claim: unknown mode refused");
ok(refused(await claim("service_role", B, "live", "acct_1"), /invalid_customer/), "claim: non-customer id refused");
ok(refused(await claim("service_role", NOBODY, "live", "cus_G1"), /foreign key/), "claim: unknown user refused (foreign key)");
ok(refused(await as("service_role", null, `UPDATE public.stripe_customers SET stripe_customer_id = 'cus_REBOUND' WHERE user_id = '${A}'`), /permission denied/),
  "authz: even the service role cannot rebind a stored customer (no UPDATE)");
ok(Number(one(await svc(`SELECT count(*) FROM pg_proc WHERE proname = 'claim_stripe_customer' AND NOT prosecdef`))) === 1,
  "authz: claim_stripe_customer is SECURITY INVOKER");

// 3b. the card-saved webhook's RPC claims the card's customer too (first writer wins).
await svc(`INSERT INTO auth.users VALUES ('${GHOST}', 'g@x.test')`);
await as("service_role", null, `SELECT public.declutter_save_card('${GHOST}', 'cus_CARDg1', 'pm_9', 'visa', '4242', 'live')`);
ok(one(await svc(`SELECT stripe_customer_id FROM public.stripe_customers WHERE user_id='${GHOST}' AND wallet_mode='live'`)) === "cus_CARDg1",
  "save card: a saved card's customer becomes the member's wallet customer");
await as("service_role", null, `SELECT public.declutter_save_card('${GHOST}', 'cus_CARDg2', 'pm_10', 'visa', '4242', 'live')`);
ok(one(await svc(`SELECT stripe_customer_id FROM public.stripe_customers WHERE user_id='${GHOST}' AND wallet_mode='live'`)) === "cus_CARDg1",
  "save card: a later card never moves the wallet customer");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id='${GHOST}'`))) === 2,
  "save card: the member is still told each time (body unchanged)");
const clash = await as("service_role", null, `SELECT public.declutter_save_card('${A}', 'cus_CARDg1', 'pm_11', 'visa', '4242', 'live')`);
ok(Array.isArray(clash), "save card: a customer already stored for ANOTHER member does not fail the webhook");
ok(Number(one(await svc(`SELECT count(*) FROM public.stripe_customers WHERE stripe_customer_id='cus_CARDg1'`))) === 1
   && Number(one(await svc(`SELECT count(*) FROM public.stripe_customers WHERE user_id='${A}' AND wallet_mode='live'`))) === 0,
  "save card: ...and binds nothing to the second member");
ok(refused(await as("authenticated", GHOST, `SELECT public.declutter_save_card('${GHOST}', 'cus_X', 'pm_X', 'visa', '4242', 'live')`), /permission denied/),
  "authz: a member cannot call declutter_save_card");

// 4. authz: no client can call the claim or touch the table.
ok(refused(await claim("authenticated", C, "live", "cus_C1"), /permission denied/), "authz: authenticated cannot claim");
ok(refused(await claim("anon", C, "live", "cus_C2"), /permission denied/), "authz: anon cannot claim");
ok(refused(await as("authenticated", B, `SELECT stripe_customer_id FROM public.stripe_customers`), /permission denied/),
  "authz: a member cannot read even their own customer id");
ok(refused(await as("authenticated", C, `INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id) VALUES ('${C}', 'live', 'cus_C3')`), /permission denied/),
  "authz: a member cannot insert a row");
ok(refused(await as("anon", null, `SELECT 1 FROM public.stripe_customers`), /permission denied/), "authz: anon cannot read");

// 5. deletion cascades
await svc(`DELETE FROM auth.users WHERE id='${B}'`);
ok(Number(one(await svc(`SELECT count(*) FROM public.stripe_customers WHERE user_id='${B}'`))) === 0,
  "deletion: a deleted member's stored customers go with them");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
