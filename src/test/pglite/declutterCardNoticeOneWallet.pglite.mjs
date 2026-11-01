#!/usr/bin/env node
/**
 * PGlite proof for 20261018160108_declutter_card_notice_one_wallet (one wallet
 * card everywhere, owner 2026-10-18): the "Card saved" notice declutter_save_card
 * sends no longer promises "never charged until you check out and pay"; the rest
 * of the function (card row, wallet claim, grants) is unchanged.
 *
 *   node src/test/pglite/declutterCardNoticeOneWallet.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCardNoticeOneWallet.pglite.mjs   # RED: old notice
 *
 * Applies slice 1 (20261018090700) once, then the new migration 3 times (replay
 * safety). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE = join(REPO, "supabase/migrations/20261018090700_one_wallet_stripe_customers.sql");
const MIGRATION = process.env.MIGRATION_PATH
  ?? join(REPO, "supabase/migrations/20261018160108_declutter_card_notice_one_wallet.sql");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  INSERT INTO auth.users VALUES ('${A}', 'a@x.test');
  CREATE TABLE public.declutter_buyer_cards (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_'),
    payment_method_id text NOT NULL CHECK (payment_method_id ~ '^pm_'),
    brand text, last4 text, card_mode text, saved_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.notifications (user_id uuid, title text, message text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title, p_body) $$;
`);
await db.exec(readFileSync(BASE, "utf8"));
const skip = process.env.NEW_MIGRATION === "skip";
const sql = readFileSync(MIGRATION, "utf8");
for (let i = 0; i < (skip ? 0 : 3); i++) await db.exec(sql);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const q = async (s) => { try { return (await db.query(s)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
async function as(role, s) {
  try { await db.exec(`SET ROLE ${role};`); return (await db.query(s)).rows; }
  catch (e) { return { error: String(e.message ?? e) }; }
  finally { await db.exec("RESET ROLE;"); }
}

const saved = await as("service_role", `SELECT public.declutter_save_card('${A}', 'cus_TESTa1', 'pm_1', 'visa', '4242', 'test')`);
ok(Array.isArray(saved), "service role saves a card");
const body = (await q(`SELECT message AS body FROM public.notifications WHERE user_id='${A}'`))[0]?.body ?? "";
ok(!/never charged/i.test(body), `the notice no longer says "never charged" (got: ${body})`);
ok(/charged only when you buy, or automatically where you turned on automatic charges/.test(body),
  "the notice says: charged only when you buy, or automatically where you turned on automatic charges");
ok((await q(`SELECT stripe_customer_id FROM public.stripe_customers WHERE user_id='${A}' AND wallet_mode='test'`))[0]?.stripe_customer_id === "cus_TESTa1",
  "unchanged: the card's customer is still claimed for the wallet");
ok((await q(`SELECT payment_method_id FROM public.declutter_buyer_cards WHERE user_id='${A}'`))[0]?.payment_method_id === "pm_1",
  "unchanged: the card row is stored");
const denied = await as("authenticated", `SELECT public.declutter_save_card('${A}', 'cus_X', 'pm_X', 'visa', '4242', 'test')`);
ok(!Array.isArray(denied) && /permission denied/.test(denied.error), "authz: a member still cannot call declutter_save_card");
const anon = await as("anon", `SELECT public.declutter_save_card('${A}', 'cus_X', 'pm_X', 'visa', '4242', 'test')`);
ok(!Array.isArray(anon) && /permission denied/.test(anon.error), "authz: anon still cannot call declutter_save_card");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
