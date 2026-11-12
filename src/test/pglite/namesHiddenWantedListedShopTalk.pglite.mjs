#!/usr/bin/env node
/**
 * PGlite proof for 20261112052501 (b1e/b1f review follow-up): no name across a block or a ban (declutter_names_hidden) in
 *   declutter_my_wanted      a reply's seller_name reads "A neighbor" (a blocked seller's reply is still left out),
 *   declutter_listed_for_me  helpr_first_name is '' (the card says "Your Helpr"),
 *   shops_my_talks / shops_talk_view  the shop sees the buyer as "A shopper".
 * Clean members are still named; no row is added or dropped.
 *
 *   node src/test/pglite/namesHiddenWantedListedShopTalk.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/namesHiddenWantedListedShopTalk.pglite.mjs # RED: the previous bodies
 *   MUTANT=wanted|listed|myTalks|talkView|listedOneSide node ...                       # each must FAIL
 *
 * World: the PREVIOUS bodies (20261102013814, 20261101034159, 20261105185006, 20261105225245) created first,
 * declutter_names_hidden VERBATIM from 20261112010100, member_display_name VERBATIM from 20261021131322, then this
 * migration 3x. Stubbed, and said so: require_feature does nothing; declutter_wanted_pairs returns no rows;
 * declutter_seller_hidden is false; are_users_blocked reads user_blocks either way; shop_talk_side answers 'buyer' for
 * the talk's buyer and 'shop' for the shop owner; shop_state_ok is true.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_names_hidden_wanted_listed_shop_talk.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s);
  return t.slice(s, t.indexOf(`${tag};`, open + tag.length + 4) + tag.length + 1);
}
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name");
const namesHidden = fnFrom("20261112010100_declutter_names_hidden_across_block_or_ban.sql", "CREATE OR REPLACE FUNCTION public.declutter_names_hidden(");
const prev = [
  fnFrom("20261102013814_declutter_my_wanted_reply_deadlines.sql", "CREATE OR REPLACE FUNCTION public.declutter_my_wanted()"),
  fnFrom("20261101034159_declutter_list_for_seller.sql", "CREATE OR REPLACE FUNCTION public.declutter_listed_for_me()"),
  fnFrom("20261105185006_shops_talk.sql", "CREATE OR REPLACE FUNCTION public.shops_my_talks()"),
  fnFrom("20261105225245_shops_talk_inbox_and_reports.sql", "CREATE OR REPLACE FUNCTION public.shops_talk_view(p_talk_id uuid)"),
].join("\n");

const MUTANTS = {
  wanted: ["'seller_name', CASE WHEN public.declutter_names_hidden(v_uid, o.seller_id) THEN", "'seller_name', CASE WHEN false THEN"],
  listed: ["CASE WHEN public.declutter_names_hidden(l.seller_id, l.helpr_id) THEN ''", "CASE WHEN false THEN ''"],
  listedOneSide: ["CASE WHEN public.declutter_names_hidden(l.seller_id, l.helpr_id) THEN ''", "CASE WHEN public.declutter_names_hidden(l.seller_id, l.seller_id) THEN ''"],
  myTalks: ["                    WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'\n                    ELSE", "                    WHEN false THEN 'A shopper'\n                    ELSE"],
  talkView: ["                        WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'\n", "                        WHEN false THEN 'A shopper'\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
// WANDA posts a Wanted. ANN (clean), DEE (banned), TIM (temp ban ran out), PAT (live temp ban), BOB (WANDA blocked him)
// each reply as sellers. HAL, a Helpr, listed items for SELLA; HAL2 is banned. SHOP is owned by OWEN; buyers ANN, DEE, BOB.
const WANDA = U(1), ANN = U(2), DEE = U(3), TIM = U(4), PAT = U(5), BOB = U(6), SELLA = U(7), HAL = U(8), HAL2 = U(9), OWEN = U(10), HAL3 = U(11);
const W1 = "33333333-0000-0000-0000-000000000001";
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SHOP = "44444444-0000-0000-0000-000000000001";
const T = (n) => `55555555-0000-0000-0000-00000000000${n}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, title text, current_price_cents integer,
    price_cents integer, status text);
  CREATE TABLE public.declutter_item_photos (item_id uuid, storage_path text, position integer);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, floor_price_cents integer);
  CREATE TABLE public.declutter_wanted (id uuid PRIMARY KEY, user_id uuid, what text, category text, max_price_cents integer,
    radius_miles numeric, status text, expires_at timestamptz, created_at timestamptz DEFAULT now(), public boolean,
    photo_paths text[], removed_at timestamptz);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, seller_id uuid,
    buyer_id uuid, wanted_id uuid, amount_cents integer, status text, awaiting text, respond_by timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE public.declutter_cart_items (offer_id uuid, buyer_id uuid, status text, checkout_by timestamptz,
    created_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_listed_for_seller (item_id uuid, job_id uuid, seller_id uuid, helpr_id uuid,
    sent_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT clock_timestamp());
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text);
  CREATE TABLE public.shop_talks (id uuid PRIMARY KEY, shop_id uuid, buyer_id uuid, buyer_read_at timestamptz, shop_read_at timestamptz);
  CREATE TABLE public.shop_talk_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), talk_id uuid, sender_side text,
    body text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_wanted_pairs(a uuid, b uuid, c boolean) RETURNS TABLE(item_id uuid) LANGUAGE sql STABLE AS
    $f$ SELECT NULL::uuid WHERE false $f$;
  CREATE FUNCTION public.declutter_seller_hidden(a uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_blocks x WHERE (x.blocker_id = a AND x.blocked_id = b) OR (x.blocker_id = b AND x.blocked_id = a)) $f$;
  CREATE FUNCTION public.shop_talk_side(p_talk uuid, p_uid uuid) RETURNS text LANGUAGE sql STABLE AS
    $f$ SELECT CASE WHEN t.buyer_id = p_uid THEN 'buyer' WHEN s.owner_id = p_uid THEN 'shop' END
          FROM public.shop_talks t JOIN public.shops s ON s.id = t.shop_id WHERE t.id = p_talk $f$;
  CREATE FUNCTION public.shop_state_ok(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  ${memberDisplayName}
  ${namesHidden}
  INSERT INTO public.profiles (user_id, full_name, ban_status, auto_suspended_until) VALUES
    ('${WANDA}', 'Wanda Wade', NULL, NULL), ('${ANN}', 'Ann Savoie', NULL, NULL), ('${DEE}', 'Dee Dupre', 'banned', NULL),
    ('${TIM}', 'Tim Thibodeaux', 'temp_banned', now() - interval '1 day'), ('${PAT}', 'Pat Prejean', 'temp_banned', now() + interval '1 day'),
    ('${BOB}', 'Bob Boudreaux', NULL, NULL), ('${SELLA}', 'Sella Simon', NULL, NULL), ('${HAL}', 'Hal Hebert', NULL, NULL),
    ('${HAL2}', 'Hank Hidalgo', 'permanently_banned', NULL), ('${OWEN}', 'Owen Oubre', NULL, NULL), ('${HAL3}', 'Hugo Hymel', NULL, NULL);
  INSERT INTO public.user_blocks VALUES ('${WANDA}', '${BOB}'), ('${HAL3}', '${SELLA}'), ('${OWEN}', '${BOB}');
  INSERT INTO public.declutter_wanted (id, user_id, what, max_price_cents, radius_miles, status, expires_at, public, photo_paths)
    VALUES ('${W1}', '${WANDA}', 'Lamp', 5000, 10, 'open', now() + interval '5 days', true, ARRAY[]::text[]);
  INSERT INTO public.declutter_items (id, seller_id, title, current_price_cents, price_cents, status) VALUES
    ('${I(1)}', '${ANN}', 'Lamp A', 3000, 3000, 'live'), ('${I(2)}', '${DEE}', 'Lamp D', 3000, 3000, 'live'),
    ('${I(3)}', '${TIM}', 'Lamp T', 3000, 3000, 'live'), ('${I(4)}', '${PAT}', 'Lamp P', 3000, 3000, 'live'),
    ('${I(5)}', '${BOB}', 'Lamp B', 3000, 3000, 'live'),
    ('${I(6)}', '${SELLA}', 'Chair', 4000, 4000, 'pending_seller_approval'), ('${I(7)}', '${SELLA}', 'Desk', 4000, 4000, 'pending_seller_approval'),
    ('${I(8)}', '${SELLA}', 'Rug', 4000, 4000, 'pending_seller_approval');
  INSERT INTO public.declutter_offers (item_id, seller_id, buyer_id, wanted_id, amount_cents, status, awaiting) VALUES
    ('${I(1)}', '${ANN}', '${WANDA}', '${W1}', 3000, 'open', 'buyer'), ('${I(2)}', '${DEE}', '${WANDA}', '${W1}', 3000, 'open', 'buyer'),
    ('${I(3)}', '${TIM}', '${WANDA}', '${W1}', 3000, 'open', 'buyer'), ('${I(4)}', '${PAT}', '${WANDA}', '${W1}', 3000, 'open', 'buyer'),
    ('${I(5)}', '${BOB}', '${WANDA}', '${W1}', 3000, 'open', 'buyer');
  INSERT INTO public.declutter_listed_for_seller (item_id, seller_id, helpr_id) VALUES
    ('${I(6)}', '${SELLA}', '${HAL}'), ('${I(7)}', '${SELLA}', '${HAL2}'), ('${I(8)}', '${SELLA}', '${HAL3}');
  INSERT INTO public.shops VALUES ('${SHOP}', '${OWEN}', 'Owen''s Antiques');
  INSERT INTO public.shop_talks (id, shop_id, buyer_id) VALUES ('${T(1)}', '${SHOP}', '${ANN}'), ('${T(2)}', '${SHOP}', '${DEE}'), ('${T(3)}', '${SHOP}', '${BOB}');
  INSERT INTO public.shop_talk_messages (talk_id, sender_side, body) VALUES
    ('${T(1)}', 'buyer', 'hi'), ('${T(2)}', 'buyer', 'hi'), ('${T(3)}', 'buyer', 'hi');
  ${prev}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const as = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
};

// 1. My Wanted replies.
const mw = await as(WANDA, "SELECT replies FROM public.declutter_my_wanted()");
const replies = Array.isArray(mw) ? mw[0].replies : [];
const sellerOf = (title) => replies.find((r) => r.item_title === title)?.seller_name;
check(sellerOf("Lamp A") === "Ann S.", `My Wanted: a clean seller is named -> ${sellerOf("Lamp A")}`);
check(sellerOf("Lamp D") === "A neighbor", `My Wanted: a banned seller reads "A neighbor" -> ${sellerOf("Lamp D")}`);
check(sellerOf("Lamp P") === "A neighbor", `My Wanted: a seller on a live temp ban reads "A neighbor" -> ${sellerOf("Lamp P")}`);
check(sellerOf("Lamp T") === "Tim T.", `My Wanted: a temp ban that ran out is named again -> ${sellerOf("Lamp T")}`);
check(replies.length === 4 && sellerOf("Lamp B") === undefined, `My Wanted: the blocked seller's reply is still left out; banned replies stay (${replies.length})`);
check(JSON.stringify(replies).search(/Dee|Pat|Bob/) < 0, "My Wanted: no banned or blocked seller's name");

// 2. Listed for me.
const lf = await as(SELLA, "SELECT title, helpr_first_name FROM public.declutter_listed_for_me()");
const helprOf = (t) => (Array.isArray(lf) ? lf.find((r) => r.title === t)?.helpr_first_name : undefined);
check(helprOf("Chair") === "Hal", `Listed for you: a clean Helpr is named -> ${helprOf("Chair")}`);
check(helprOf("Desk") === "", `Listed for you: a banned Helpr is '' -> ${JSON.stringify(helprOf("Desk"))}`);
check(helprOf("Rug") === "", `Listed for you: a Helpr who blocked the seller is '' -> ${JSON.stringify(helprOf("Rug"))}`);
check(Array.isArray(lf) && lf.length === 3, "Listed for you: every listing still shows");

// 3. Shops inbox (the shop's side) and the buyer's side.
const inbox = await as(OWEN, "SELECT public.shops_my_talks() AS j");
const labels = Array.isArray(inbox) ? inbox[0].j.map((r) => r.other_label).sort() : [];
check(JSON.stringify(labels) === JSON.stringify(["A shopper", "A shopper", "Ann"]), `Shops inbox: clean buyer named, banned + blocked read "A shopper" -> ${JSON.stringify(labels)}`);
const dee = await as(DEE, "SELECT public.shops_my_talks() AS j");
check(Array.isArray(dee) && dee[0].j[0].other_label === "Owen's Antiques", "Shops inbox: the buyer still sees the shop's name");

// 4. Shops thread.
const view = async (uid, t) => { const r = await as(uid, `SELECT public.shops_talk_view('${t}') AS j`); return Array.isArray(r) ? r[0].j.other_label : r.error; };
check((await view(OWEN, T(1))) === "Ann", "Shops thread: a clean buyer is named");
check((await view(OWEN, T(2))) === "A shopper", "Shops thread: a banned buyer reads \"A shopper\"");
check((await view(OWEN, T(3))) === "A shopper", "Shops thread: a blocked buyer reads \"A shopper\"");
check((await view(DEE, T(2))) === "Owen's Antiques", "Shops thread: the buyer still sees the shop's name");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
