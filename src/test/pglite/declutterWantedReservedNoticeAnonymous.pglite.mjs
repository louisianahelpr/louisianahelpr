#!/usr/bin/env node
/**
 * PGlite proof for 20261112010200 (b1d review follow-up): the buyer's "Reserved for you" notice from declutter_take_item
 * no longer names the seller on an offer answering a Wanted post ("The seller accepted your ..."), and across a block
 * (either way) or a ban (either side) neither take_item notice names the other member. A clean, non-Wanted pair is
 * still named both ways; titles are unchanged.
 *
 *   node src/test/pglite/declutterWantedReservedNoticeAnonymous.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedReservedNoticeAnonymous.pglite.mjs # RED: the previous body
 *   MUTANT=wantedNamed|blockNamesSeller|blockNamesBuyer node ...                               # each must FAIL
 *
 * World: the PREVIOUS declutter_take_item (20261112004748) created first, declutter_names_hidden VERBATIM from
 * 20261112010100, then this migration 3x. member_display_name VERBATIM from 20261021131322. Stubbed, and said so: the
 * helpers take_item calls do the minimum; declutter_notify records (user, title, message).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql"));
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
const prevTake = fnFrom("20261112004748_declutter_seller_notices_name_the_buyer.sql", "CREATE OR REPLACE FUNCTION public.declutter_take_item(");

const MUTANTS = {
  wantedNamed: ["    v_seller_anon := (p_offer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL))\n                     OR",
                "    v_seller_anon := false\n                     OR"],
  blockNamesSeller: ["                     OR public.declutter_names_hidden(p_buyer, v_seller);\n", "                     OR false;\n"],
  blockNamesBuyer: ["       AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN\n", "       THEN\n"],
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
// SAM sells. ANN: clean buyer. WANDA: a Wanted poster. BOB: SAM blocked him. DEE: banned.
const SAM = U(1), ANN = U(2), WANDA = U(3), BOB = U(4), DEE = U(5);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text, current_price_cents integer,
    is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
    awaiting text, status text NOT NULL DEFAULT 'open', respond_by timestamptz, wanted_id uuid, voided_by_line uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text, amount_cents integer);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    price_cents integer, source text, offer_id uuid, checkout_by timestamptz, status text NOT NULL DEFAULT 'in_cart',
    reminded_24h_at timestamptz, reminded_2h_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notes (user_id uuid, title text, message text, at serial);
  CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE FUNCTION public.declutter_hold_length(p integer, s text) RETURNS interval LANGUAGE sql AS $f$ SELECT interval '24 hours' $f$;
  CREATE FUNCTION public.continue_day_label(d date, t time) RETURNS text LANGUAGE sql AS $f$ SELECT 'Wed, Nov 11 at 2:00 PM' $f$;
  CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $f$ SELECT '$' || to_char(p / 100.0, 'FM999990.00') $f$;
  CREATE FUNCTION public.declutter_free_hold_charge_words(u uuid) RETURNS text LANGUAGE sql AS $f$ SELECT 'No charge.' $f$;
  CREATE FUNCTION public.declutter_notice_ref(o uuid) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.notes (user_id, title, message) VALUES (p_user, p_title, p_message) $f$;
  ${memberDisplayName}
  ${namesHidden}
  INSERT INTO public.profiles (user_id, full_name, ban_status) VALUES
    ('${SAM}', 'Sam Seller', NULL), ('${ANN}', 'Ann Savoie', NULL), ('${WANDA}', 'Wanda Wantsit', NULL),
    ('${BOB}', 'Bob Boudreaux', NULL), ('${DEE}', 'Dee Dupre', 'banned');
  INSERT INTO public.user_blocks VALUES ('${SAM}', '${BOB}');
  INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents) VALUES
    ('${I(1)}', '${SAM}', 'live', 'Lamp', 4000), ('${I(2)}', '${SAM}', 'live', 'Rug', 4000), ('${I(3)}', '${SAM}', 'live', 'Chair', 4000),
    ('${I(4)}', '${SAM}', 'live', 'Desk', 4000), ('${I(5)}', '${SAM}', 'live', 'Mirror', 4000), ('${I(6)}', '${SAM}', 'live', 'Stool', 0);
  INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id) VALUES
    ('${O(1)}', '${I(1)}', '${ANN}', '${SAM}', 3500, 'seller', now() + interval '1 day', NULL),
    ('${O(2)}', '${I(2)}', '${WANDA}', '${SAM}', 3500, 'buyer', now() + interval '1 day', '${O(9)}'),
    ('${O(3)}', '${I(3)}', '${BOB}', '${SAM}', 3500, 'seller', now() + interval '1 day', NULL),
    ('${O(4)}', '${I(4)}', '${DEE}', '${SAM}', 3500, 'seller', now() + interval '1 day', NULL);
  ${prevTake}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const last = async (uid, title) => (await db.query(`SELECT message FROM public.notes WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}' ORDER BY at DESC LIMIT 1`)).rows[0]?.message ?? null;
const take = (buyer, item, price, source, offer) => svc(`SELECT public.declutter_take_item('${item}', '${buyer}', ${price}, '${source}', ${offer ? `'${offer}'` : "NULL"})`);
const RES = "Reserved for you: check out in 24 hours", BUY = "Someone's buying your item";

// 1. A clean, non-Wanted accepted offer: named both ways (unchanged).
await take(ANN, I(1), 3500, "offer", O(1));
check(/^Sam S\. accepted your \$35\.00 offer for "Lamp"/.test((await last(ANN, RES)) ?? ""), `clean pair: the buyer reads the seller's name -> ${await last(ANN, RES)}`);
check((await last(SAM, BUY)) === "\"Lamp\" is held for Ann S. at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", "clean pair: the seller reads the buyer's name");

// 2. An offer answering a Wanted post: the buyer's notice no longer names the seller.
await take(WANDA, I(2), 3500, "offer", O(2));
const w = await last(WANDA, RES);
check(/^The seller accepted your \$35\.00 offer for "Rug"\. Check out by Wed, Nov 11 at 2:00 PM/.test(w ?? ""), `Wanted thread: "The seller accepted ..." -> ${w}`);
check((await last(SAM, BUY)) === "\"Rug\" is held for the buyer at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", "Wanted thread: the seller's notice stays anonymous");

// 3. A blocked pair, and a banned buyer: neither side named.
await take(BOB, I(3), 3500, "offer", O(3));
check(/^The seller accepted your \$35\.00 offer for "Chair"/.test((await last(BOB, RES)) ?? ""), `block: the buyer reads "The seller" -> ${await last(BOB, RES)}`);
check((await last(SAM, BUY)) === "\"Chair\" is held for the buyer at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", "block: the seller reads \"the buyer\"");
await take(DEE, I(4), 3500, "offer", O(4));
check(/^The seller accepted your \$35\.00 offer for "Desk"/.test((await last(DEE, RES)) ?? ""), "ban: the banned buyer reads \"The seller\"");
check((await last(SAM, BUY)) === "\"Desk\" is held for the buyer at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", "ban: the seller reads \"the buyer\"");
// Buy now and a free claim across a block keep the old words too.
await take(BOB, I(5), 4000, "buy", null);
check((await last(SAM, BUY)) === "Someone is checking out \"Mirror\" for $40.00. It's held for them for 30 minutes. We'll tell you when they pay.", "block: Buy now says \"Someone\"");
await take(DEE, I(6), 0, "free", null);
check((await last(SAM, "Someone claimed your free item")) === "\"Stool\" was claimed. The buyer has 48 hours to choose a pickup.", "ban: a free claim keeps the old words");

const all = (await svc(`SELECT message FROM public.notes WHERE user_id IN ('${WANDA}', '${BOB}', '${DEE}')`)).map((r) => r.message).join("\n");
check(!/Sam/.test(all), "no Wanted, blocked or banned buyer's notice names the seller");
const sam = (await svc(`SELECT message FROM public.notes WHERE user_id = '${SAM}'`)).map((r) => r.message).join("\n");
check(!/Wanda|Bob|Dee/.test(sam), "the seller's notices name no Wanted, blocked or banned buyer");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
