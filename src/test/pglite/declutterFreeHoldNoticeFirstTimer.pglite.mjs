#!/usr/bin/env node
/**
 * PGlite proof for 20261107185819_declutter_free_pick_notice_first_timer (11-07 free-claim trace): the notice a member
 * gets when a giver picks them for a free item no longer says "Nothing is charged." when the one-time ID check is
 * ahead of them (declutter_free_claim_gate's rule); everyone else reads it as before, and paid holds are untouched.
 *
 *   node src/test/pglite/declutterFreeHoldNoticeFirstTimer.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeHoldNoticeFirstTimer.pglite.mjs # RED: the first-timer reads "Nothing is charged."
 *   MUTANT=<name> node src/test/pglite/declutterFreeHoldNoticeFirstTimer.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_take_item (this migration, or its newest earlier CREATE when skipped), declutter_setup_fee_due_cents.
 * Stubbed, said so: identity_check_exempt and is_identity_verified (read two test columns on profiles: the switch and
 * Stripe's answer are not part of this change), declutter_notify (writes the bell row), declutter_notice_ref,
 * declutter_hold_length (48 h free, 30 min buy), declutter_price_text, seed_hidden_for (false), member_display_name.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261107185819_declutter_free_pick_notice_first_timer.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The admin is read through the caller-scoped has_role-like path (never true here): an admin taker is told about a check.
  noAdmin: ["      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_buyer AND ur.role = 'admin')\n", ""],
  // Paid fee alone is enough (the ID not checked).
  feeOnly: ["public.declutter_setup_fee_due_cents(p_buyer) = 0 AND public.is_identity_verified(p_buyer)", "public.declutter_setup_fee_due_cents(p_buyer) = 0"],
  // The exemption (switch off / test account) ignored.
  noExempt: ["      OR public.identity_check_exempt(p_buyer)\n", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), NEWBIE = U(2), PAIDNOTVERIFIED = U(3), DONE = U(4), ADMIN = U(5), EXEMPT = U(6), BUYER = U(7);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, onboarding_fee_paid boolean DEFAULT false,
  t_verified boolean DEFAULT false, t_exempt boolean DEFAULT false);
CREATE TABLE public.platform_settings (onboarding_fee_cents integer);
INSERT INTO public.platform_settings VALUES (200);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.identity_check_exempt(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT COALESCE((SELECT t_exempt FROM public.profiles WHERE user_id = u), false) $$;
CREATE FUNCTION public.is_identity_verified(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT COALESCE((SELECT t_verified FROM public.profiles WHERE user_id = u), false) $$;
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_type, p_title, p_message, p_link) $$;
CREATE FUNCTION public.declutter_notice_ref(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_hold_length(p integer, s text) RETURNS interval LANGUAGE sql AS $$ SELECT CASE WHEN p = 0 THEN interval '48 hours' ELSE interval '30 minutes' END $$;
CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || (p / 100)::text $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(n text, f text) RETURNS text LANGUAGE sql AS $$ SELECT COALESCE(n, f) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, status text DEFAULT 'live',
  is_seed boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, status text,
  closed_at timestamptz, updated_at timestamptz, voided_by_line uuid);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  price_cents integer, source text, offer_id uuid, checkout_by timestamptz);
`);
await db.exec(definitionBefore("declutter_setup_fee_due_cents", THIS));
await db.exec(definitionBefore("declutter_take_item", THIS));

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
await q(`INSERT INTO public.profiles (user_id, onboarding_fee_paid, t_verified, t_exempt) VALUES
  ($1, false, false, false), ($2, false, false, false), ($3, true, false, false), ($4, true, true, false), ($5, false, false, false), ($6, false, false, true), ($7, false, false, false)`,
  [SELLER, NEWBIE, PAIDNOTVERIFIED, DONE, ADMIN, EXEMPT, BUYER]);
await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);
const take = async (buyer, price, source = "buy") => {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, title) VALUES ($1, 'Blue Toy Farm Tractor') RETURNING id`, [SELLER]))[0].id;
  await q(`SELECT public.declutter_take_item($1, $2, $3, $4, NULL)`, [item, buyer, price, source]);
  return (await q(`SELECT title, message FROM public.notifications WHERE user_id = $1 ORDER BY ctid DESC LIMIT 1`, [buyer]))[0];
};
const FIRST = "The item stays free. Your first free item has a one-time ID check before you get the address; we show you the cost first.";
const BASE = '"Blue Toy Farm Tractor" is free and held for you. Choose how you\'ll pick it up within 48 hours or it goes back up. ';

const newbie = await take(NEWBIE, 0);
check(newbie?.title === "It's yours: pick a pickup within 48 hours", `the free hold notice still goes, same title (${newbie?.title})`);
check(newbie?.message === BASE + FIRST, `[fix] a first-timer is told about the one-time ID check, never "Nothing is charged" (${newbie?.message})`);
const half = await take(PAIDNOTVERIFIED, 0);
check(half?.message === BASE + FIRST, `[fix] fee paid but ID not verified: the check is still ahead (${half?.message})`);
const done = await take(DONE, 0);
check(done?.message === BASE + "Nothing is charged.", `fee paid and verified: unchanged, nothing is charged (${done?.message})`);
const admin = await take(ADMIN, 0);
check(admin?.message === BASE + "Nothing is charged.", `an admin (the gate lets them through): nothing is charged (${admin?.message})`);
const exempt = await take(EXEMPT, 0);
check(exempt?.message === BASE + "Nothing is charged.", `exempt (switch off, or a test account): nothing is charged (${exempt?.message})`);
const paid = await take(BUYER, 4000, "buy");
check(paid?.title === "Reserved for you: check out within 30 minutes" && !/ID check/.test(paid?.message ?? ""), `a paid Buy now hold is untouched (${paid?.title})`);
if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_free_hold_charge_words(uuid)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_free_hold_charge_words(uuid)', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_free_hold_charge_words(uuid)', 'EXECUTE') s,
    has_function_privilege('authenticated', 'public.declutter_take_item(uuid,uuid,integer,text,uuid)', 'EXECUTE') t`))[0];
  check(!acl.a && !acl.u && acl.s && !acl.t, `grants: helper and take_item service-only (${JSON.stringify(acl)})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
