#!/usr/bin/env node
/**
 * PGlite proof for 20261103053759_replace_dead_stripe_customer.sql (Q2140): the guarded swap of a member's stored
 * wallet customer that Stripe no longer has.
 *
 *   node src/test/pglite/replaceDeadStripeCustomer.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/replaceDeadStripeCustomer.pglite.mjs  # RED (prod today: no replace path)
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: the REAL wallet table statements of 20261018090700 (table, RLS, grants as prod has them: service_role
 * SELECT, INSERT, DELETE; information_schema 2026-11-02) and declutter_buyer_cards as prod has it (columns,
 * PK (user_id), service_role all); then this migration 3x. pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261103053759_replace_dead_stripe_customer.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT REFERENCES, SELECT ON auth.users TO service_role;`);
{
  const wallet = readFileSync(`${MIG_DIR}20261018090700_one_wallet_stripe_customers.sql`, "utf8");
  const from = wallet.indexOf("CREATE TABLE IF NOT EXISTS public.stripe_customers (");
  const marker = "GRANT SELECT, INSERT, DELETE ON TABLE public.stripe_customers TO service_role;";
  const to = wallet.indexOf(marker) + marker.length;
  if (from < 0 || to < marker.length) throw new Error("20261018090700: wallet table statements not found");
  await db.exec(wallet.slice(from, to));
}
await db.exec(`
CREATE TABLE public.declutter_buyer_cards (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_'),
  payment_method_id text NOT NULL CHECK (payment_method_id ~ '^pm_'),
  brand text, last4 text, saved_at timestamptz NOT NULL DEFAULT now(),
  card_mode text NOT NULL CHECK (card_mode IN ('live', 'test')));
ALTER TABLE public.declutter_buyer_cards ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.declutter_buyer_cards TO service_role;
ALTER ROLE service_role BYPASSRLS;`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}

const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";
await db.exec(`
INSERT INTO auth.users VALUES ('${A}'), ('${B}');
INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id) VALUES
  ('${A}', 'test', 'cus_deadA'), ('${A}', 'live', 'cus_liveA'), ('${B}', 'test', 'cus_okB');
INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, card_mode) VALUES
  ('${A}', 'cus_deadA', 'pm_a', 'test'), ('${B}', 'cus_okB', 'pm_b', 'test');`);

const as = async (role, sql) => {
  await db.exec(`SET ROLE ${role};`);
  try {
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE;");
  }
};
const stored = async (u, m) => (await db.query(`SELECT stripe_customer_id s FROM public.stripe_customers WHERE user_id = '${u}' AND wallet_mode = '${m}'`)).rows[0]?.s ?? null;
const cards = async (u) => (await db.query(`SELECT count(*)::int n FROM public.declutter_buyer_cards WHERE user_id = '${u}'`)).rows[0].n;

// 1. The swap, as service_role: the dead id is replaced, the dead card goes, nothing else moves.
const r1 = await as("service_role", `SELECT public.replace_stripe_customer('${A}', 'test', 'cus_deadA', 'cus_newA') AS id`);
ok(r1.rows?.[0]?.id === "cus_newA", "service_role swaps the dead customer and gets the new id", JSON.stringify(r1));
ok((await stored(A, "test")) === "cus_newA", "  the stored test customer is the new one");
ok((await stored(A, "live")) === "cus_liveA", "  the member's other mode is untouched");
ok((await cards(A)) === 0, "  their Declutter card on the dead customer is deleted");
ok((await stored(B, "test")) === "cus_okB" && (await cards(B)) === 1, "  another member's wallet and card are untouched");

// 2. A racing second caller (its p_old no longer stored) changes nothing and converges on the stored id.
const r2 = await as("service_role", `SELECT public.replace_stripe_customer('${A}', 'test', 'cus_deadA', 'cus_otherA') AS id`);
ok(r2.rows?.[0]?.id === "cus_newA" && (await stored(A, "test")) === "cus_newA", "a stale old id is a no-op and returns the stored id", JSON.stringify(r2));

// 3. Another member's live customer can never be swapped out by naming it.
const r3 = await as("service_role", `SELECT public.replace_stripe_customer('${A}', 'test', 'cus_okB', 'cus_stealB') AS id`);
ok((await stored(B, "test")) === "cus_okB" && r3.rows?.[0]?.id === "cus_newA", "naming another member's id swaps nothing", JSON.stringify(r3));

// 4. Bad input raises.
const bad = await as("service_role", `SELECT public.replace_stripe_customer('${A}', 'test', 'cus_newA', 'cus_newA')`);
ok(/invalid_customer/.test(bad.error ?? ""), "the same old and new id is refused", JSON.stringify(bad));
const badMode = await as("service_role", `SELECT public.replace_stripe_customer('${A}', 'prod', 'cus_newA', 'cus_x')`);
ok(/invalid_mode/.test(badMode.error ?? ""), "an unknown mode is refused", JSON.stringify(badMode));

// 5. No client role may call it.
for (const role of ["anon", "authenticated"]) {
  const r = await as(role, `SELECT public.replace_stripe_customer('${A}', 'test', 'cus_newA', 'cus_zz')`);
  ok(/permission denied/i.test(r.error ?? ""), `${role} cannot call it`, JSON.stringify(r));
}
const acl = (await db.query(`SELECT proacl::text a, prosecdef FROM pg_proc WHERE proname = 'replace_stripe_customer'`)).rows;
ok(acl.length === 1 && !acl[0].prosecdef && !/=X\//.test(acl[0].a.replace(/(service_role|postgres)=X\//g, "")),
  "one function, SECURITY INVOKER, EXECUTE only for service_role", JSON.stringify(acl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
