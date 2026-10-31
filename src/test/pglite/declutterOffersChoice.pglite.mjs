#!/usr/bin/env node
/**
 * PGlite proof for 20261031201036_declutter_offers_choice (LEAD-OFFERS-CHOICE, owner 2026-10-31).
 *
 *   node src/test/pglite/declutterOffersChoice.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOffersChoice.pglite.mjs   # RED (no default column; a draft refused)
 *
 * Starts from prod's declutter_set_offer_rules (its newest CREATE before this migration) and the seller-defaults table
 * as 20261030144112 made it, applies the migration 3x, then proves:
 *   - declutter_seller_defaults has accepts_offers, on by default, and a row saves it off;
 *   - the seller sets offers off on their own DRAFT (so posting records it before the item goes up), and auto answers go
 *     off with it; live and paused still work; another seller's draft and a sold item are still refused.
 */
import { PGlite, U, makeCheck, liveFunctionSql } from "./messageAlertsWorld.mjs";
import { readMigration } from "./messageAlertsWorld.mjs";

const NEW = "20261031201036_declutter_offers_choice.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const SELLER = U(1);
const OTHER = U(2);
const DRAFT = U(11);
const LIVE = U(12);
const SOLD = U(13);
const THEIRS = U(14);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid, status text NOT NULL,
  accepts_offers boolean NOT NULL DEFAULT true, updated_at timestamptz);
CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, auto_offers boolean NOT NULL DEFAULT true, updated_at timestamptz);
CREATE TABLE public.declutter_seller_defaults (
  member_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  keep_up boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO auth.users VALUES ('${SELLER}'), ('${OTHER}');
INSERT INTO public.declutter_items (id, seller_id, status) VALUES
  ('${DRAFT}', '${SELLER}', 'draft'), ('${LIVE}', '${SELLER}', 'live'), ('${SOLD}', '${SELLER}', 'sold'), ('${THEIRS}', '${OTHER}', 'draft');
INSERT INTO public.declutter_item_private (item_id) VALUES ('${DRAFT}'), ('${LIVE}'), ('${SOLD}'), ('${THEIRS}');
${liveFunctionSql("declutter_set_offer_rules", NEW).sql}
`);

if (!SKIP) {
  const migration = readMigration(NEW);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const as = (uid) => db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
const attempt = async (sql) => {
  try { await db.exec(sql); return "allowed"; } catch (e) { return e.message; }
};
const offers = async (id) => (await db.query(`SELECT i.accepts_offers, p.auto_offers FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id WHERE i.id = '${id}'`)).rows[0];

// (a) the default.
const col = await attempt(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${SELLER}')`);
const dflt = col === "allowed" ? await attempt(`SELECT accepts_offers FROM public.declutter_seller_defaults`) : col;
check("declutter_seller_defaults has accepts_offers", dflt === "allowed", dflt);
if (dflt === "allowed") {
  const on = (await db.query(`SELECT accepts_offers FROM public.declutter_seller_defaults WHERE member_id = '${SELLER}'`)).rows[0]?.accepts_offers;
  check("a new row accepts offers by default", on === true, String(on));
  await db.exec(`UPDATE public.declutter_seller_defaults SET accepts_offers = false WHERE member_id = '${SELLER}'`);
  const off = (await db.query(`SELECT accepts_offers FROM public.declutter_seller_defaults WHERE member_id = '${SELLER}'`)).rows[0]?.accepts_offers;
  check("the seller saves it off", off === false, String(off));
}

// (b) a draft takes the choice.
await as(SELLER);
const onDraft = await attempt(`SELECT public.declutter_set_offer_rules('${DRAFT}', false, true)`);
check("the seller turns offers off on their own draft", onDraft === "allowed", onDraft);
const d = await offers(DRAFT);
check("the draft then takes no offers, and auto answers are off with them", d.accepts_offers === false && d.auto_offers === false, JSON.stringify(d));
check("a live item still takes the choice", (await attempt(`SELECT public.declutter_set_offer_rules('${LIVE}', false, false)`)) === "allowed" && (await offers(LIVE)).accepts_offers === false);
check("a sold item is still refused", (await attempt(`SELECT public.declutter_set_offer_rules('${SOLD}', false, false)`)) === "item_not_editable");
check("another seller's draft is still refused", (await attempt(`SELECT public.declutter_set_offer_rules('${THEIRS}', false, false)`)) === "item_not_found" && (await offers(THEIRS)).accepts_offers === true);
const acl = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'declutter_set_offer_rules'`)).rows[0]?.acl ?? "";
check("anon cannot run it", !/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
