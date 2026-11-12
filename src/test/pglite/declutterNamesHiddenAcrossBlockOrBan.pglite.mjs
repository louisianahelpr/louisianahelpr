#!/usr/bin/env node
/**
 * PGlite proof for 20261112010100 (b1d review follow-up): once either side blocks the other, or either member is banned,
 * the seller's offer card (declutter_my_offers.buyer_display), trade card (declutter_my_trade_buyer_names) and the new
 * notices from declutter_respond_offer and declutter_deadline_sweep no longer name the other member; they fall back to
 * the anonymous form (NULL on the card, "The buyer" in the notice). A clean pair is still named; lifting the block or the
 * ban brings the name back; no client role can call declutter_names_hidden.
 *
 *   node src/test/pglite/declutterNamesHiddenAcrossBlockOrBan.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNamesHiddenAcrossBlockOrBan.pglite.mjs # RED: the previous bodies
 *   MUTANT=oneWayBlock|noBan|lapsedTempBan|offerCardKept|tradeCardKept|respondKept|sweepKept|clientGrant node ... # each must FAIL
 *
 * World: the PREVIOUS bodies (declutter_my_offers 20261111223500, declutter_my_trade_buyer_names 20261112004253,
 * declutter_respond_offer 20261112003050, declutter_deadline_sweep 20261112004748) created first, then this migration
 * 3x. member_display_name VERBATIM from 20261021131322. Stubbed, and said so: the helpers the bodies call do the minimum;
 * declutter_notify records (user, title, message). Tables carry the columns read.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_names_hidden_across_block_or_ban.sql"));
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
const prev = [
  fnFrom("20261111223500_declutter_my_offers_buyer_display.sql", "CREATE FUNCTION public.declutter_my_offers("),
  fnFrom("20261112004253_declutter_trade_buyer_names.sql", "CREATE OR REPLACE FUNCTION public.declutter_my_trade_buyer_names("),
  fnFrom("20261112003050_declutter_offer_notices_name_the_buyer.sql", "CREATE OR REPLACE FUNCTION public.declutter_respond_offer("),
  fnFrom("20261112004748_declutter_seller_notices_name_the_buyer.sql", "CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep("),
];

const MUTANTS = {
  oneWayBlock: ["                     OR (b.blocker_id = p_b AND b.blocked_id = p_a))\n", ")\n"],
  noBan: ["                    AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')\n", "                    AND false\n"],
  lapsedTempBan: ["                         OR p.auto_suspended_until > now()));", "                         OR true));"],
  respondKept: ["  IF o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN\n", "  IF o.wanted_id IS NULL THEN\n"],
  sweepKept: ["      CASE WHEN o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id)\n", "      CASE WHEN o.wanted_id IS NULL\n"],
  offerCardKept: ["               AND NOT public.declutter_names_hidden(o.seller_id, o.buyer_id)\n", ""],
  tradeCardKept: ["  SELECT s.id, CASE WHEN NOT public.declutter_names_hidden(s.buyer_id, s.seller_id)\n", "  SELECT s.id, CASE WHEN true\n"],
  clientGrant: ["GRANT EXECUTE ON FUNCTION public.declutter_names_hidden(uuid, uuid) TO service_role;", "GRANT EXECUTE ON FUNCTION public.declutter_names_hidden(uuid, uuid) TO authenticated, service_role;"],
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
// SAM sells to everyone. ANN: clean pair. BOB: SAM blocked him. CAL: blocked SAM. DEE: banned. EVE: temp ban lapsed.
// VIC sells and is banned; ANN offers to him too.
const SAM = U(1), ANN = U(2), BOB = U(3), CAL = U(4), DEE = U(5), EVE = U(6), VIC = U(7);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text, current_price_cents integer,
    accepts_offers boolean DEFAULT true, is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, floor_price_cents integer);
  CREATE TABLE public.declutter_wanted (id uuid PRIMARY KEY, user_id uuid, status text);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
    awaiting text, status text NOT NULL DEFAULT 'open', respond_by timestamptz, counter_count integer NOT NULL DEFAULT 0,
    wanted_id uuid, voided_by_line uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_swap_offers (id uuid PRIMARY KEY, item_id uuid, offered_item_id uuid, buyer_id uuid, seller_id uuid,
    status text, respond_by timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz, closed_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text, amount_cents integer);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    price_cents integer, source text, offer_id uuid, checkout_by timestamptz, status text NOT NULL DEFAULT 'in_cart',
    reminded_24h_at timestamptz, reminded_2h_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.declutter_handover_talks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), closed_at timestamptz, expires_at timestamptz);
  CREATE TABLE public.declutter_bundle_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    status text NOT NULL DEFAULT 'open', respond_by timestamptz, is_seed boolean, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_bundle_request_items (request_id uuid, item_id uuid, price_cents integer);
  CREATE TABLE public.notes (user_id uuid, title text, message text, at serial);
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE sql AS $f$ SELECT auth.uid() $f$;
  CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $f$ SELECT '$' || to_char(p / 100.0, 'FM999990.00') $f$;
  CREATE FUNCTION public.declutter_notice_ref(o uuid) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_pair_talking(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.notes (user_id, title, message) VALUES (p_user, p_title, p_message) $f$;
  ${memberDisplayName}
  INSERT INTO public.profiles (user_id, full_name, ban_status, auto_suspended_until) VALUES
    ('${SAM}', 'Sam Seller', NULL, NULL), ('${ANN}', 'Ann Savoie', NULL, NULL), ('${BOB}', 'Bob Boudreaux', NULL, NULL),
    ('${CAL}', 'Cal Comeaux', NULL, NULL), ('${DEE}', 'Dee Dupre', 'banned', NULL),
    ('${EVE}', 'Eve Esteve', 'temp_banned', now() - interval '1 hour'), ('${VIC}', 'Vic Vidrine', 'permanently_banned', NULL);
  INSERT INTO public.user_blocks VALUES ('${SAM}', '${BOB}'), ('${CAL}', '${SAM}');
  INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents) VALUES
    ('${I(1)}', '${SAM}', 'live', 'Lamp', 5000), ('${I(2)}', '${SAM}', 'live', 'Rug', 5000), ('${I(3)}', '${SAM}', 'live', 'Chair', 5000),
    ('${I(4)}', '${SAM}', 'live', 'Desk', 5000), ('${I(5)}', '${SAM}', 'live', 'Mirror', 5000), ('${I(6)}', '${VIC}', 'live', 'Vase', 5000),
    ('${I(7)}', '${VIC}', 'live', 'Clock', 5000), ('${I(8)}', '${SAM}', 'live', 'Bowl', 5000), ('${I(9)}', '${SAM}', 'live', 'Fan', 5000),
    ('${I(10)}', '${SAM}', 'live', 'Stool', 5000);
  -- Open offers, all the seller's turn, live: ANN, BOB, CAL, DEE, EVE to SAM; ANN to banned VIC (two).
  INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by) VALUES
    ('${O(1)}', '${I(1)}', '${ANN}', '${SAM}', 4000, 'seller', now() + interval '1 day'),
    ('${O(2)}', '${I(2)}', '${BOB}', '${SAM}', 4000, 'seller', now() + interval '1 day'),
    ('${O(3)}', '${I(3)}', '${CAL}', '${SAM}', 4000, 'seller', now() + interval '1 day'),
    ('${O(4)}', '${I(4)}', '${DEE}', '${SAM}', 4000, 'seller', now() + interval '1 day'),
    ('${O(5)}', '${I(5)}', '${EVE}', '${SAM}', 4000, 'seller', now() + interval '1 day'),
    ('${O(6)}', '${I(6)}', '${ANN}', '${VIC}', 4000, 'seller', now() + interval '1 day'),
    ('${O(7)}', '${I(7)}', '${ANN}', '${VIC}', 4000, 'buyer', now() + interval '1 day');
  INSERT INTO public.declutter_swap_offers (id, item_id, offered_item_id, buyer_id, seller_id, status) VALUES
    ('${O(11)}', '${I(1)}', gen_random_uuid(), '${ANN}', '${SAM}', 'open'),
    ('${O(12)}', '${I(2)}', gen_random_uuid(), '${BOB}', '${SAM}', 'open'),
    ('${O(13)}', '${I(3)}', gen_random_uuid(), '${CAL}', '${SAM}', 'open'),
    ('${O(14)}', '${I(4)}', gen_random_uuid(), '${DEE}', '${SAM}', 'open'),
    ('${O(15)}', '${I(5)}', gen_random_uuid(), '${EVE}', '${SAM}', 'open'),
    ('${O(16)}', '${I(6)}', gen_random_uuid(), '${ANN}', '${VIC}', 'open');
  ${prev.join("\n")}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

async function as(uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const cardName = async (viewer, offer) => {
  const r = await as(viewer, `SELECT buyer_display FROM public.declutter_my_offers() WHERE offer_id = '${offer}'`);
  return Array.isArray(r) ? (r[0]?.buyer_display ?? null) : r;
};
const tradeName = async (viewer, swap) => {
  const r = await as(viewer, `SELECT buyer_display FROM public.declutter_my_trade_buyer_names() WHERE swap_id = '${swap}'`);
  return Array.isArray(r) ? (r[0]?.buyer_display ?? null) : r;
};

// 1. Offer cards (seller SAM; seller VIC).
check(await cardName(SAM, O(1)) === "Ann S.", "offer card: a clean pair is still named");
check(await cardName(SAM, O(2)) === null, "offer card: the seller blocked the buyer -> no name");
check(await cardName(SAM, O(3)) === null, "offer card: the buyer blocked the seller -> no name");
check(await cardName(SAM, O(4)) === null, "offer card: the buyer is banned -> no name");
check(await cardName(SAM, O(5)) === "Eve E.", "offer card: a temp ban that has run out hides nothing");
check(await cardName(VIC, O(6)) === null, "offer card: the viewing seller is banned -> the buyer's name is hidden from them");

// 2. Trade cards.
check(await tradeName(SAM, O(11)) === "Ann S.", "trade card: a clean pair is still named");
check(await tradeName(SAM, O(12)) === null, "trade card: the seller blocked the buyer -> no name");
check(await tradeName(SAM, O(13)) === null, "trade card: the buyer blocked the seller -> no name");
check(await tradeName(SAM, O(14)) === null, "trade card: the buyer is banned -> no name");
check(await tradeName(VIC, O(16)) === null, "trade card: the viewing seller is banned -> no name");
const tradeRows = await as(SAM, `SELECT count(*)::int AS n FROM public.declutter_my_trade_buyer_names()`);
check(tradeRows[0]?.n === 5, `trade card: the rows stay (only the name goes) -> ${JSON.stringify(tradeRows)}`);

// 3. respond_offer: ANN withdraws her offer to banned seller VIC, and says no to VIC's price.
await as(ANN, `SELECT public.declutter_respond_offer('${O(6)}', 'withdraw', NULL)`);
let n = (await svc(`SELECT message FROM public.notes WHERE user_id = '${VIC}' AND title = 'Offer withdrawn'`))[0]?.message;
check(n === 'The buyer took back their offer on "Vase".', `withdraw to a banned seller -> "The buyer" -> ${n}`);
await as(ANN, `SELECT public.declutter_respond_offer('${O(7)}', 'decline', NULL)`);
n = (await svc(`SELECT message FROM public.notes WHERE user_id = '${VIC}' AND title = 'Offer declined'`))[0]?.message;
check(/^The buyer said no to your \$40\.00 price on "Clock"/.test(n ?? ""), `buyer's no to a banned seller -> "The buyer" -> ${n}`);
// A clean pair still names the buyer.
await svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by) VALUES ('${O(8)}', '${I(8)}', '${ANN}', '${SAM}', 4000, 'seller', now() + interval '1 day')`);
await as(ANN, `SELECT public.declutter_respond_offer('${O(8)}', 'withdraw', NULL)`);
n = (await svc(`SELECT message FROM public.notes WHERE user_id = '${SAM}' AND title = 'Offer withdrawn'`))[0]?.message;
check(n === 'Ann S. took back their offer on "Bowl".', `withdraw, clean pair -> named -> ${n}`);

// 4. The sweep: every remaining open offer to SAM runs out now.
await svc(`UPDATE public.declutter_offers SET respond_by = now() - interval '1 minute' WHERE status = 'open'`);
const sw = await svc(`SELECT public.declutter_deadline_sweep() AS r`);
check(Array.isArray(sw), `the sweep runs -> ${sw.error ?? "ok"}`);
const expired = (await svc(`SELECT message FROM public.notes WHERE user_id = '${SAM}' AND title = 'Offer expired' ORDER BY at`)).map((r) => r.message);
check(expired.includes("You did not answer Ann S.'s offer on \"Lamp\" within 48 hours, so it closed."), `sweep: a clean pair is named -> ${JSON.stringify(expired)}`);
check(expired.includes("You did not answer Eve E.'s offer on \"Mirror\" within 48 hours, so it closed."), "sweep: a lapsed temp ban is named");
for (const [t, why] of [["Rug", "the seller blocked the buyer"], ["Chair", "the buyer blocked the seller"], ["Desk", "the buyer is banned"]]) {
  check(expired.includes(`You did not answer an offer on "${t}" within 48 hours, so it closed.`), `sweep: ${why} -> the old words, no name`);
}
const all = (await svc(`SELECT message FROM public.notes`)).map((r) => r.message).join("\n");
check(!/Bob|Cal|Dee|Boudreaux|Comeaux|Dupre/.test(all), "no notice names a blocked or banned party");
check(expired.length === 5, `sweep: five expiry notices -> ${expired.length}`);

// 5. Lifting the block brings the name back on the card.
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${SAM}' AND blocked_id = '${BOB}'`);
await svc(`UPDATE public.declutter_swap_offers SET status = 'open'`);
check(await tradeName(SAM, O(12)) === "Bob B.", "unblocking brings the trade card name back");

// 6. No client role may call the helper (it answers for any pair).
const acl = await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_names_hidden(uuid, uuid)', 'EXECUTE') AS a,
                              has_function_privilege('anon', 'public.declutter_names_hidden(uuid, uuid)', 'EXECUTE') AS b`);
check(Array.isArray(acl) && acl[0].a === false && acl[0].b === false, `declutter_names_hidden: no anon/authenticated EXECUTE -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
