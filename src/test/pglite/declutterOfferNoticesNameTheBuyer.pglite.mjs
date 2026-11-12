#!/usr/bin/env node
/**
 * PGlite proof for 20261112003050 (F356 follow-up, owner 11-11 ~5:00 PM): the seller's offer notices name the buyer as
 * first name + last initial ("Ann S. offered $40.00 on "Lamp". ..."), matching the seller's offer card. Buyer-facing
 * notices are unchanged; a thread answering a Wanted post (wanted_id set) keeps the old anonymous words; a buyer with
 * no name keeps the old words.
 *
 *   node src/test/pglite/declutterOfferNoticesNameTheBuyer.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOfferNoticesNameTheBuyer.pglite.mjs # RED: the previous bodies
 *   MUTANT=wantedNamed|fullName|counterBothSides|noFallback node ...                     # each must FAIL
 *
 * World: the PREVIOUS bodies (declutter_make_offer from 20261110202142, declutter_respond_offer from 20261111191033)
 * are created first, then this migration 3x. member_display_name runs VERBATIM from 20261021131322. Stubbed, and said
 * so: the helpers the two bodies call (require_feature, is_caller_banned, declutter_assert_member,
 * declutter_lock_buyable_item, declutter_take_item, declutter_seller_out, declutter_member_out, are_users_blocked,
 * member_under_18, declutter_notice_ref) do the minimum, and declutter_notify records (user, title, message). This
 * proves the notice wording of the restated bodies, not the helpers.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_offer_notices_name_the_buyer.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head, end = "$fn$;") {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  return t.slice(s, t.indexOf(end, s) + end.length);
}
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name");
const prevMake = fnFrom("20261110202142_notice_titles_by_outcome_plain_words.sql", "CREATE OR REPLACE FUNCTION public.declutter_make_offer(");
const prevRespond = fnFrom("20261111191033_declutter_seller_counter_declined_words.sql", "CREATE OR REPLACE FUNCTION public.declutter_respond_offer(");

const MUTANTS = {
  wantedNamed: ["  IF o.wanted_id IS NULL THEN\n    SELECT public.member_display_name", "  IF true THEN\n    SELECT public.member_display_name"],
  fullName: ["SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = o.buyer_id;",
             "SELECT bp.full_name INTO v_buyer FROM public.profiles bp WHERE bp.user_id = o.buyer_id;"],
  counterBothSides: ["      CASE WHEN v_side = 'buyer' AND v_buyer IS NOT NULL\n        THEN format('%s sent a", "      CASE WHEN v_buyer IS NOT NULL\n        THEN format('%s sent a"],
  noFallback: ["    CASE WHEN v_buyer IS NOT NULL\n      THEN format('%s offered $%s on \"%s\". Accept", "    CASE WHEN true\n      THEN format('%s offered $%s on \"%s\". Accept"],
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
const SELLER = U(1), ANN = U(2), NONAME = U(3), WANTER = U(4);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const W = "44444444-0000-0000-0000-000000000001";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, phone text);
  REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text,
    current_price_cents integer, accepts_offers boolean DEFAULT true);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, auto_offers boolean DEFAULT false, floor_price_cents integer);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    amount_cents integer, awaiting text, status text NOT NULL DEFAULT 'open', respond_by timestamptz, counter_count integer NOT NULL DEFAULT 0,
    wanted_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text, amount_cents integer);
  CREATE TABLE public.declutter_buyer_cards (user_id uuid PRIMARY KEY);
  CREATE TABLE public.notes (user_id uuid, title text, message text, at serial);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE sql AS $f$ SELECT auth.uid() $f$;
  CREATE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
    RETURNS record LANGUAGE sql AS $f$ SELECT seller_id, current_price_cents, title FROM public.declutter_items WHERE id = p_item_id $f$;
  CREATE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid) RETURNS void
    LANGUAGE sql AS $f$ UPDATE public.declutter_offers SET status = 'accepted' WHERE id = p_offer_id; UPDATE public.declutter_items SET status = 'reserved' WHERE id = p_item_id $f$;
  CREATE FUNCTION public.declutter_seller_out(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_notice_ref(o uuid) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.notes (user_id, title, message) VALUES (p_user, p_title, p_message) $f$;
  ${memberDisplayName}
  INSERT INTO public.profiles (user_id, full_name) VALUES
    ('${SELLER}', 'Sam Seller'), ('${ANN}', '  Ann Marie  Savoie '), ('${NONAME}', '   '), ('${WANTER}', 'Wanda Wantsit');
  INSERT INTO public.declutter_buyer_cards VALUES ('${ANN}'), ('${NONAME}'), ('${WANTER}');
  INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents) VALUES
    ('${I(1)}', '${SELLER}', 'live', 'Lamp', 5000), ('${I(2)}', '${SELLER}', 'live', 'Rug', 5000),
    ('${I(3)}', '${SELLER}', 'live', 'Chair', 5000), ('${I(4)}', '${SELLER}', 'live', 'Desk', 5000),
    ('${I(5)}', '${SELLER}', 'live', 'Mirror', 5000), ('${I(6)}', '${SELLER}', 'live', 'Shelf', 5000),
    ('${I(7)}', '${SELLER}', 'live', 'Stool', 5000), ('${I(8)}', '${SELLER}', 'live', 'Vase', 5000);
  INSERT INTO public.declutter_item_private (item_id, auto_offers, floor_price_cents) VALUES
    ('${I(1)}', false, 3000), ('${I(2)}', false, 3000), ('${I(3)}', true, 3500), ('${I(4)}', true, 3500),
    ('${I(5)}', false, 3000), ('${I(6)}', false, 3000), ('${I(7)}', false, 3000), ('${I(8)}', true, 3500);
  ${prevMake}
  ${prevRespond}
  GRANT EXECUTE ON FUNCTION public.declutter_make_offer(uuid, integer), public.declutter_respond_offer(uuid, text, integer) TO authenticated;
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
    await db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const last = async (uid) => (await db.query(`SELECT title, message FROM public.notes WHERE user_id = '${uid}' ORDER BY at DESC LIMIT 1`)).rows[0] ?? {};
const make = async (uid, item, cents) => (await as(uid, `SELECT public.declutter_make_offer('${item}', ${cents})::text AS id`))?.[0]?.id;
const respond = (uid, id, action, cents = "NULL") => as(uid, `SELECT public.declutter_respond_offer('${id}', '${action}', ${cents}) AS r`);
const STILL = "Accept, decline or send a different price within 48 hours.";

// 1. A new offer: the seller reads the buyer's first name + last initial.
const o1 = await make(ANN, I(1), 4000);
let n = await last(SELLER);
check(n.title === "New offer" && n.message === `Ann S. offered $40.00 on "Lamp". ${STILL}`, `new offer names the buyer -> ${n.message}`);
check(!/Savoie|Marie/.test(n.message ?? ""), "never the full name");

// 2. The seller counters; the buyer's notice is unchanged (it never names anyone new).
await respond(SELLER, o1, "counter", 4500);
n = await last(ANN);
check(n.message === `You got a $45.00 counteroffer on "Lamp". ${STILL}`, `the buyer's counter notice unchanged -> ${n.message}`);
// 3. The buyer counters back: the seller reads the name.
await respond(ANN, o1, "counter", 4200);
n = await last(SELLER);
check(n.title === "New counteroffer" && n.message === `Ann S. sent a $42.00 counteroffer on "Lamp". ${STILL}`, `buyer's counter names the buyer -> ${n.message}`);
// 4. The seller counters again, the buyer says no: the seller reads the name.
await respond(SELLER, o1, "counter", 4600);
await respond(ANN, o1, "decline");
n = await last(SELLER);
check(n.title === "Offer declined" && n.message === `Ann S. said no to your $46.00 price on "Lamp". Your listing is still up.`, `buyer's no names the buyer -> ${n.message}`);

// 5. The buyer takes an offer back.
const o2 = await make(ANN, I(2), 4000);
await respond(ANN, o2, "withdraw");
n = await last(SELLER);
check(n.title === "Offer withdrawn" && n.message === `Ann S. took back their offer on "Rug".`, `withdraw names the buyer -> ${n.message}`);

// 6. A seller's no tells the buyer the same words as before.
const o5 = await make(ANN, I(5), 4000);
await respond(SELLER, o5, "decline");
n = await last(ANN);
check(n.message === 'Your offer on "Mirror" was declined. Nothing was charged.', `the buyer's decline words unchanged -> ${n.message}`);

// 7. Smart offers: answered automatically (below the floor) and accepted automatically (at/above it).
await make(ANN, I(3), 3000);
n = await last(SELLER);
check(n.title === "Offer answered automatically" && n.message === 'Ann S. offered $30.00 on "Chair". You answered automatically with your lowest price, $35.00.', `auto-answered names the buyer -> ${n.message}`);
await make(ANN, I(4), 4000);
n = await last(SELLER);
check(n.title === "Offer accepted automatically" && n.message === `Ann S.'s $40.00 offer on "Desk" was accepted automatically (at or above your lowest price).`, `auto-accepted names the buyer -> ${n.message}`);

// 7b. respond_offer's own automatic accept: the seller's lowest-price counter, then the buyer counters at/above it.
const o8 = await make(ANN, I(8), 3000);
await respond(ANN, o8, "counter", 3600);
n = await last(SELLER);
check(n.title === "Offer accepted automatically" && n.message === `Ann S.'s $36.00 offer on "Vase" was accepted automatically (at or above your lowest price).`, `respond_offer auto-accept names the buyer -> ${n.message}`);

// 8. A buyer with no name: the old words, never "null" or an empty name.
await make(NONAME, I(6), 4000);
n = await last(SELLER);
check(n.message === `You got a $40.00 offer on "Shelf". ${STILL}`, `no name -> the old words -> ${n.message}`);

// 9. A thread answering a Wanted post stays anonymous on every seller notice.
await db.exec(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id)
  VALUES ('${W}', '${I(7)}', '${WANTER}', '${SELLER}', 4000, 'buyer', now() + interval '1 day', '${W}')`);
await respond(WANTER, W, "counter", 3500);
n = await last(SELLER);
check(n.message === `You got a $35.00 counteroffer on "Stool". ${STILL}`, `Wanted reply: the counter stays anonymous -> ${n.message}`);
await respond(SELLER, W, "counter", 3900);
await respond(WANTER, W, "decline");
n = await last(SELLER);
check(n.message === 'The buyer said no to your $39.00 price on "Stool". Your listing is still up.', `Wanted reply: the no stays anonymous -> ${n.message}`);
const all = (await db.query(`SELECT message FROM public.notes`)).rows.map((r) => r.message).join("\n");
check(!/Wanda|Savoie|Marie/.test(all), "no notice holds a Wanted poster's name or anyone's full name");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
