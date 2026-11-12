#!/usr/bin/env node
/**
 * PGlite proof for 20261112004748 (F356 follow-up part 2, owner 11-11 "everywhere"): the seller's bundle-request,
 * offer-expired and take_item ("Someone claimed" / "Someone's buying") notices name the buyer as first name + last
 * initial; a buyer with no name and a Wanted thread keep the old words; buyer notices and titles are unchanged.
 *
 *   node src/test/pglite/declutterSellerNoticesNameTheBuyer.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerNoticesNameTheBuyer.pglite.mjs # RED: the previous bodies
 *   MUTANT=sweepWanted|takeWanted|fullName|bundleNoFallback node ...                       # each must FAIL
 *
 * World: the PREVIOUS bodies (declutter_request_bundle 20261104103528, declutter_deadline_sweep 20261108195151,
 * declutter_take_item 20261110223800) created first, then this migration 3x. member_display_name VERBATIM from
 * 20261021131322. Stubbed, and said so: the helpers the bodies call (require_feature, is_caller_banned,
 * declutter_assert_member, declutter_identity_gate, declutter_lock_buyable_item, seed_hidden_for, declutter_hold_length,
 * continue_day_label, declutter_price_text, declutter_free_hold_charge_words, declutter_notice_ref,
 * declutter_pair_talking) do the minimum; declutter_notify records (user, title, message). Tables carry the columns read.
 * This proves the notice wording of the restated bodies, not the helpers.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_seller_notices_name_the_buyer.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head, end) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  return t.slice(s, t.indexOf(end, s) + end.length);
}
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name", "$fn$;");
const prev = [
  fnFrom("20261104103528_declutter_bundle_request.sql", "CREATE OR REPLACE FUNCTION public.declutter_request_bundle(", "$function$;"),
  fnFrom("20261108195151_declutter_trades_fixes.sql", "CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep(", "$function$;"),
  fnFrom("20261110223800_declutter_reserved_notice_names_the_deadline.sql", "CREATE OR REPLACE FUNCTION public.declutter_take_item(", "$function$;"),
];

const MUTANTS = {
  sweepWanted: ["      CASE WHEN o.wanted_id IS NULL\n           THEN (SELECT", "      CASE WHEN true\n           THEN (SELECT"],
  takeWanted: ["    IF p_offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL) THEN", "    IF true THEN"],
  fullName: ["      SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = p_buyer;",
             "      SELECT bp.full_name INTO v_buyer FROM public.profiles bp WHERE bp.user_id = p_buyer;"],
  bundleNoFallback: ["           COALESCE(v_buyer, 'A buyer'), cardinality(v_ids)", "           v_buyer, cardinality(v_ids)"],
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
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text, current_price_cents integer,
    is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
    awaiting text, status text NOT NULL DEFAULT 'open', respond_by timestamptz, wanted_id uuid, voided_by_line uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text, amount_cents integer);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    price_cents integer, source text, offer_id uuid, checkout_by timestamptz, status text NOT NULL DEFAULT 'in_cart',
    reminded_24h_at timestamptz, reminded_2h_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.declutter_handover_talks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), closed_at timestamptz, expires_at timestamptz);
  CREATE TABLE public.declutter_bundle_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    status text NOT NULL DEFAULT 'open', respond_by timestamptz, is_seed boolean, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.declutter_bundle_request_items (request_id uuid, item_id uuid, price_cents integer);
  CREATE TABLE public.notes (user_id uuid, title text, message text, at serial);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE sql AS $f$ SELECT auth.uid() $f$;
  CREATE FUNCTION public.declutter_identity_gate(u uuid, c text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
    RETURNS record LANGUAGE sql AS $f$ SELECT seller_id, current_price_cents, title FROM public.declutter_items WHERE id = p_item_id $f$;
  CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE FUNCTION public.declutter_hold_length(p integer, s text) RETURNS interval LANGUAGE sql AS $f$ SELECT interval '24 hours' $f$;
  CREATE FUNCTION public.continue_day_label(d date, t time) RETURNS text LANGUAGE sql AS $f$ SELECT 'Wed, Nov 11 at 2:00 PM' $f$;
  CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $f$ SELECT '$' || to_char(p / 100.0, 'FM999990.00') $f$;
  CREATE FUNCTION public.declutter_free_hold_charge_words(u uuid) RETURNS text LANGUAGE sql AS $f$ SELECT 'No charge.' $f$;
  CREATE FUNCTION public.declutter_notice_ref(o uuid) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.declutter_pair_talking(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.notes (user_id, title, message) VALUES (p_user, p_title, p_message) $f$;
  ${memberDisplayName}
  INSERT INTO public.profiles (user_id, full_name) VALUES
    ('${SELLER}', 'Sam Seller'), ('${ANN}', '  Ann Marie  Savoie '), ('${NONAME}', '   '), ('${WANTER}', 'Wanda Wantsit');
  INSERT INTO public.declutter_items (id, seller_id, status, title, current_price_cents) VALUES
    ('${I(1)}', '${SELLER}', 'live', 'Lamp', 2000), ('${I(2)}', '${SELLER}', 'live', 'Rug', 2500),
    ('${I(3)}', '${SELLER}', 'live', 'Chair', 0), ('${I(4)}', '${SELLER}', 'live', 'Desk', 4000),
    ('${I(5)}', '${SELLER}', 'live', 'Mirror', 4000), ('${I(6)}', '${SELLER}', 'live', 'Shelf', 4000),
    ('${I(7)}', '${SELLER}', 'live', 'Stool', 4000), ('${I(8)}', '${SELLER}', 'live', 'Vase', 2000),
    ('${I(9)}', '${SELLER}', 'live', 'Clock', 2000), ('${I(10)}', '${SELLER}', 'live', 'Bowl', 4000),
    ('${I(11)}', '${SELLER}', 'live', 'Fan', 4000);
  ${prev.join("\n")}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
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
const last = async (uid, title) => (await db.query(`SELECT title, message FROM public.notes WHERE user_id = '${uid}'${title ? ` AND title = '${title.replace(/'/g, "''")}'` : ""} ORDER BY at DESC LIMIT 1`)).rows[0] ?? {};
const take = (buyer, item, price, source, offer = "NULL") => svc(`SELECT public.declutter_take_item('${item}', '${buyer}', ${price}, '${source}', ${offer === "NULL" ? "NULL" : `'${offer}'`})`);

// 1. Bundle request.
const b = await as(ANN, `SELECT public.declutter_request_bundle(ARRAY['${I(1)}', '${I(2)}']::uuid[]) AS id`);
let n = await last(SELLER, "Bundle request");
check(n.message === "Ann S. wants 2 of your items ($45.00 in all). Accept all or pick some within 48 hours.", `bundle names the buyer -> ${n.message ?? JSON.stringify(b)}`);
await as(NONAME, `SELECT public.declutter_request_bundle(ARRAY['${I(8)}', '${I(9)}']::uuid[]) AS id`);
n = await last(SELLER, "Bundle request");
check(n.message === "A buyer wants 2 of your items ($40.00 in all). Accept all or pick some within 48 hours.", `bundle with no name -> the old words -> ${n.message}`);

// 2. take_item: free claim, Buy now, accepted offer, and an offer answering a Wanted post.
await take(ANN, I(3), 0, "free");
n = await last(SELLER, "Someone claimed your free item");
check(n.message === 'Ann S. claimed "Chair". They have 48 hours to choose a pickup.', `free claim names the claimer -> ${n.message}`);
await take(ANN, I(4), 4000, "buy");
n = await last(SELLER, "Someone's buying your item");
check(n.message === "Ann S. is checking out \"Desk\" for $40.00. It's held for them for 30 minutes. We'll tell you when they pay.", `Buy now names the buyer -> ${n.message}`);
await svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by) VALUES ('${O(1)}', '${I(5)}', '${ANN}', '${SELLER}', 3500, 'seller', now() + interval '1 day')`);
await take(ANN, I(5), 3500, "offer", O(1));
n = await last(SELLER, "Someone's buying your item");
check(n.message === "\"Mirror\" is held for Ann S. at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", `accepted offer names the buyer -> ${n.message}`);
await svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id) VALUES ('${O(2)}', '${I(6)}', '${WANTER}', '${SELLER}', 3500, 'buyer', now() + interval '1 day', '${O(9)}')`);
await take(WANTER, I(6), 3500, "offer", O(2));
n = await last(SELLER, "Someone's buying your item");
check(n.message === "\"Shelf\" is held for the buyer at $35.00. They have 24 hours to check out and pay. We'll tell you when they pay.", `Wanted thread: take_item stays anonymous -> ${n.message}`);
await take(NONAME, I(7), 4000, "buy");
n = await last(SELLER, "Someone's buying your item");
check(n.message === "Someone is checking out \"Stool\" for $40.00. It's held for them for 30 minutes. We'll tell you when they pay.", `Buy now with no name -> the old words -> ${n.message}`);
// The buyer's own notice is unchanged (no new name in it).
n = await last(ANN, "Reserved for you: check out in 24 hours");
check(/^Sam S\. accepted your \$35\.00 offer for "Mirror"/.test(n.message ?? ""), `the buyer's reserved notice unchanged -> ${n.message}`);

// 3. The deadline sweep's offer-expired seller notices.
await svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id) VALUES
  ('${O(3)}', '${I(10)}', '${ANN}', '${SELLER}', 3000, 'buyer', now() - interval '1 minute', NULL),
  ('${O(4)}', '${I(11)}', '${ANN}', '${SELLER}', 3000, 'seller', now() - interval '1 minute', NULL),
  ('${O(5)}', '${I(8)}', '${WANTER}', '${SELLER}', 1500, 'buyer', now() - interval '1 minute', '${O(9)}')`);
const sw = await svc(`SELECT public.declutter_deadline_sweep() AS r`);
check(Array.isArray(sw), `the sweep runs -> ${sw.error ?? "ok"}`);
const expired = (await db.query(`SELECT message FROM public.notes WHERE user_id = '${SELLER}' AND title = 'Offer expired' ORDER BY at`)).rows.map((r) => r.message);
check(expired.includes('Ann S. did not answer your counteroffer on "Bowl" within 48 hours, so it closed.'), `expiry (buyer's turn) names the buyer -> ${JSON.stringify(expired)}`);
check(expired.includes("You did not answer Ann S.'s offer on \"Fan\" within 48 hours, so it closed."), "expiry (seller's turn) names the buyer");
check(expired.includes('The buyer did not answer your counteroffer on "Vase" within 48 hours, so it closed.'), "Wanted thread: the expiry stays anonymous");

const all = (await db.query(`SELECT message FROM public.notes`)).rows.map((r) => r.message).join("\n");
check(!/Wanda|Savoie|Marie|null/.test(all), "no notice holds a Wanted poster's name, a full name or 'null'");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
