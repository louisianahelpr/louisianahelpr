#!/usr/bin/env node
/**
 * PGlite proof for 20261111201159_trade_offer_notice_leads_with_no_money.sql (F482, words half): the "New trade
 * offer" notice leads with "No money changes hands."; title, type, link, actor and the offer row do not move.
 *
 *   node src/test/pglite/tradeOfferNoticeLeadsWithNoMoney.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/tradeOfferNoticeLeadsWithNoMoney.pglite.mjs  # RED: the line sits last
 *
 * World: declutter_offer_swap from its newest earlier migration. Stubbed, and said so: the gates it calls
 * (require_feature, is_caller_banned, declutter_assert_member, declutter_identity_gate, declutter_swap_items_ok) and
 * declutter_notify (a recorder); their own proofs live elsewhere.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261111201159_trade_offer_notice_leads_with_no_money.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestBefore(fn, before) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f >= before) break;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const BUYER = "11111111-1111-1111-1111-111111111111";
const SELLER = "22222222-2222-2222-2222-222222222222";
const ITEM = "33333333-3333-3333-3333-333333333333";
const OFFERED = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid, full_name text);
INSERT INTO profiles VALUES ('${BUYER}', 'Bea Trader'), ('${SELLER}', 'Sam Seller');
CREATE TABLE public.declutter_swap_offers (id uuid primary key default gen_random_uuid(), item_id uuid, offered_item_id uuid, buyer_id uuid,
  seller_id uuid, respond_by timestamptz, is_seed boolean, status text default 'open', closed_at timestamptz, updated_at timestamptz,
  created_at timestamptz default now());
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text, actor uuid);
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT '${BUYER}'::uuid $$;
CREATE FUNCTION public.declutter_identity_gate(u uuid, c text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_swap_items_ok(a uuid, b uuid, u uuid, OUT o_seller_id uuid, OUT o_seed boolean, OUT o_title text, OUT o_offered_title text)
  LANGUAGE sql AS $$ SELECT '${SELLER}'::uuid, false, 'Oak bookshelf', 'Brass lamp' $$;
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.notices VALUES (u, t, ti, m, l, a) $$;
`);
await db.exec(newestBefore("declutter_offer_swap", MIG));
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
await db.query(`SELECT public.declutter_offer_swap($1, $2)`, [ITEM, OFFERED]);
const n = (await db.query(`SELECT * FROM notices`)).rows;
check("one notice to the seller", n.length === 1 && n[0].user_id === SELLER, n);
check("it leads with 'No money changes hands.'",
  n[0]?.message === 'No money changes hands. Bea T. offered "Brass lamp" in trade for "Oak bookshelf". Accept or decline within 48 hours.', n);
check("title, type, link and actor unchanged", n[0]?.title === "New trade offer" && n[0]?.type === "declutter_offers"
  && n[0]?.link === "/declutter?tab=selling" && n[0]?.actor === BUYER, n);
const o = (await db.query(`SELECT count(*)::int AS c FROM declutter_swap_offers WHERE status = 'open'`)).rows[0].c;
check("the offer row is written", o === 1, o);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_offer_swap'`)).rows[0]?.a ?? "";
check("anon cannot execute; authenticated can", !/\banon=/.test(acl) && /\bauthenticated=X/.test(acl), acl);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
