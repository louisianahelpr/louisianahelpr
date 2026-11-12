#!/usr/bin/env node
/**
 * PGlite proof for 20261112023602 (copy bug): when the BUYER accepts the seller's price (a counter, or any Wanted reply),
 * declutter_take_item's notices say who accepted: the buyer reads "You accepted Sam S.'s $35.00 price ...", the seller
 * "Ann S. accepted your $35.00 price ...". A seller's Accept (and an automatic accept, recorded as 'seller') keeps
 * "Sam S. accepted your $35.00 offer ..." / '"Lamp" is held for Ann S. ...'. Block/ban and Wanted anonymity unchanged.
 *
 *   node src/test/pglite/declutterReservedNoticeSaysWhoAccepted.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReservedNoticeSaysWhoAccepted.pglite.mjs # RED: the previous body
 *   MUTANT=buyerWords|sellerWords|anonIgnored node ...                                         # each must FAIL
 *
 * World: the PREVIOUS declutter_take_item (20261112022921) created first, declutter_names_hidden VERBATIM from
 * 20261112010100, then this migration 3x. member_display_name VERBATIM from 20261021131322. Stubbed, and said so: the
 * helpers take_item calls do the minimum; declutter_notify records (user, title, message). Each offer's 'accept' event is
 * inserted by the test, as the callers (respond_offer, make_offer) do just before take_item.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_reserved_notice_says_who_accepted.sql"));
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
const prevTake = fnFrom("20261112022921_declutter_wanted_reserved_notice_names_seller_again.sql", "CREATE OR REPLACE FUNCTION public.declutter_take_item(");

const MUTANTS = {
  buyerWords: ["      CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN\n        format('You accepted",
               "      CASE WHEN false THEN\n        format('You accepted"],
  sellerWords: ["      CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN\n        format('%s accepted your %s price",
                "      CASE WHEN false THEN\n        format('%s accepted your %s price"],
  anonIgnored: ["               CASE WHEN v_seller_anon THEN 'the seller''s'\n", "               CASE WHEN false THEN 'the seller''s'\n"],
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
// SAM sells. ANN: clean, SAM accepted her offer. WANDA: a Wanted poster who accepted SAM's reply. BOB: SAM blocked him,
// he accepted SAM's counter. CAL: clean, accepted SAM's counter. DEE: banned, SAM accepted her offer.
const SAM = U(1), ANN = U(2), WANDA = U(3), BOB = U(4), CAL = U(5), DEE = U(6);
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
  CREATE TABLE public.declutter_offer_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offer_id uuid, actor_side text,
    action text, amount_cents integer, created_at timestamptz NOT NULL DEFAULT now());
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
    ('${BOB}', 'Bob Boudreaux', NULL), ('${CAL}', 'Cal Comeaux', NULL), ('${DEE}', 'Dee Dupre', 'banned');
  INSERT INTO public.user_blocks VALUES ('${SAM}', '${BOB}');
  INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents) VALUES
    ('${I(1)}', '${SAM}', 'live', 'Lamp', 4000), ('${I(2)}', '${SAM}', 'live', 'Rug', 4000), ('${I(3)}', '${SAM}', 'live', 'Chair', 4000),
    ('${I(4)}', '${SAM}', 'live', 'Desk', 4000), ('${I(5)}', '${SAM}', 'live', 'Mirror', 4000);
  INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id) VALUES
    ('${O(1)}', '${I(1)}', '${ANN}', '${SAM}', 3500, 'seller', now() + interval '1 day', NULL),
    ('${O(2)}', '${I(2)}', '${WANDA}', '${SAM}', 3500, 'buyer', now() + interval '1 day', '${O(9)}'),
    ('${O(3)}', '${I(3)}', '${BOB}', '${SAM}', 3500, 'buyer', now() + interval '1 day', NULL),
    ('${O(4)}', '${I(4)}', '${CAL}', '${SAM}', 3500, 'buyer', now() + interval '1 day', NULL),
    ('${O(5)}', '${I(5)}', '${DEE}', '${SAM}', 3500, 'seller', now() + interval '1 day', NULL);
  -- The history each caller leaves: a counter by the other side, then the accept event written just before take_item.
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, created_at) VALUES
    ('${O(1)}', 'buyer', 'offer', now() - interval '1 hour'), ('${O(1)}', 'seller', 'accept', now()),
    ('${O(2)}', 'seller', 'offer', now() - interval '1 hour'), ('${O(2)}', 'buyer', 'accept', now()),
    ('${O(3)}', 'seller', 'counter', now() - interval '1 hour'), ('${O(3)}', 'buyer', 'accept', now()),
    ('${O(4)}', 'seller', 'counter', now() - interval '1 hour'), ('${O(4)}', 'buyer', 'accept', now()),
    ('${O(5)}', 'buyer', 'offer', now() - interval '1 hour'), ('${O(5)}', 'seller', 'accept', now());
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
const take = (buyer, item, offer) => svc(`SELECT public.declutter_take_item('${item}', '${buyer}', 3500, 'offer', '${offer}')`);
const RES = "Reserved for you: check out in 24 hours", BUY = "Someone's buying your item";
const TAIL = " Check out by Wed, Nov 11 at 2:00 PM to keep it: choose pickup or delivery, pick a day and time, and pay. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.";
const STAIL = " They have 24 hours to check out and pay. We'll tell you when they pay.";

// 1. The seller accepted the buyer's offer: unchanged words both ways.
await take(ANN, I(1), O(1));
check((await last(ANN, RES)) === `Sam S. accepted your $35.00 offer for "Lamp".${TAIL}`, `seller accepted: the buyer -> ${await last(ANN, RES)}`);
check((await last(SAM, BUY)) === `"Lamp" is held for Ann S. at $35.00.${STAIL}`, `seller accepted: the seller -> ${await last(SAM, BUY)}`);

// 2. A Wanted poster accepted the seller's reply: each side reads who accepted; the seller still sees no poster name.
await take(WANDA, I(2), O(2));
check((await last(WANDA, RES)) === `You accepted Sam S.'s $35.00 price for "Rug".${TAIL}`, `Wanted: the poster -> ${await last(WANDA, RES)}`);
check((await last(SAM, BUY)) === `The buyer accepted your $35.00 price for "Rug".${STAIL}`, `Wanted: the seller -> ${await last(SAM, BUY)}`);

// 3. A clean buyer accepted the seller's counter: named both ways.
await take(CAL, I(4), O(4));
check((await last(CAL, RES)) === `You accepted Sam S.'s $35.00 price for "Desk".${TAIL}`, `counter accepted: the buyer -> ${await last(CAL, RES)}`);
check((await last(SAM, BUY)) === `Cal C. accepted your $35.00 price for "Desk".${STAIL}`, `counter accepted: the seller -> ${await last(SAM, BUY)}`);

// 4. Across a block: right words, no names.
await take(BOB, I(3), O(3));
check((await last(BOB, RES)) === `You accepted the seller's $35.00 price for "Chair".${TAIL}`, `block: the buyer -> ${await last(BOB, RES)}`);
check((await last(SAM, BUY)) === `The buyer accepted your $35.00 price for "Chair".${STAIL}`, `block: the seller -> ${await last(SAM, BUY)}`);

// 5. Across a ban, seller accepted: the old anonymous words.
await take(DEE, I(5), O(5));
check((await last(DEE, RES)) === `The seller accepted your $35.00 offer for "Mirror".${TAIL}`, `ban: the buyer -> ${await last(DEE, RES)}`);
check((await last(SAM, BUY)) === `"Mirror" is held for the buyer at $35.00.${STAIL}`, `ban: the seller -> ${await last(SAM, BUY)}`);

const buyers = (await svc(`SELECT message FROM public.notes WHERE user_id IN ('${WANDA}', '${CAL}', '${BOB}')`)).map((r) => r.message).join("\n");
check(!/accepted your/.test(buyers), "no buyer who accepted is told the seller accepted their offer");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
