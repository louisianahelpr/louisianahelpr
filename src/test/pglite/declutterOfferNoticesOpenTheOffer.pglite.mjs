#!/usr/bin/env node
/**
 * Q2660 (2026-11-02): "New offer" and "New counteroffer" open the offer they name. Runs NEW_FILE VERBATIM (3x) after the
 * previous definitions of the writer (declutter_notice_type, declutter_notice_link, declutter_notice_about,
 * declutter_notice_names_item, declutter_notice_ref, declutter_notice_order_link, declutter_notify_strict,
 * declutter_notify: the Q2659 versions, which read and clear declutter.notice_ref), then writes notices through
 * declutter_notify (the path every sender uses), after declutter_notice_ref(<offer>) as the Q2659 callers do, and reads
 * the stored link and declutter_ref:
 *   - the offer's seller, sent ?tab=selling about the buyer ("New offer"): ?tab=selling&offer=<id>;
 *   - the offer's buyer, sent ?tab=buying about the seller ("New counteroffer"): ?tab=buying&offer=<id>;
 *   - the other side's tab, a link with more query, an item page, a stranger as counterpart, no counterpart,
 *     no ref, a ref that is not an offer (a cart line), a malformed ref: unchanged;
 *   - one notice only: the next notice in the same transaction, with no ref of its own, gets no &offer=;
 *   - BUY-30 still works: an order notice (declutter.notice_order) with no offer ref still gets &order=<id>;
 *   - the notice is still written, with its declutter_ref (Q2659) and its message;
 *   - grants: declutter_notice_order_link stays service_role only.
 * Stubbed, and said so: declutter_price_words returns the message; log_cron_defect records its call (a lost notice
 * must fail this proof, never pass it quietly).
 *
 *   node src/test/pglite/declutterOfferNoticesOpenTheOffer.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOfferNoticesOpenTheOffer.pglite.mjs   # RED: the previous helper
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_offer_notices_open_the_offer.sql"));
if (!NEW_FILE) throw new Error("the Q2660 offer-link migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS helper (expect FAILs)");

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
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
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "99999999-0000-0000-0000-000000000001";
const BUYER = "99999999-0000-0000-0000-000000000002";
const STRANGER = "99999999-0000-0000-0000-000000000003";
const ITEM = "bbbbbbbb-0000-4000-8000-000000000001";
const OFFER = "dddddddd-0000-4000-8000-000000000001";
const OTHER_OFFER = "dddddddd-0000-4000-8000-000000000002";
const ORDER = "aaaaaaaa-0000-4000-8000-000000000001";
const LINE = "cccccccc-0000-4000-8000-000000000001";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, type text, title text, message text, link text,
  declutter_ref uuid);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, order_id uuid, item_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid);
CREATE TABLE public.defects (fn text, ref text, err text);
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb DEFAULT NULL) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.defects VALUES (a, b, c) $$;
INSERT INTO public.profiles (user_id) VALUES ('${SELLER}'), ('${BUYER}'), ('${STRANGER}');
INSERT INTO public.declutter_items VALUES ('${ITEM}', 'Oak chair');
INSERT INTO public.declutter_orders VALUES ('${ORDER}', '${BUYER}', '${SELLER}');
INSERT INTO public.declutter_cart_items (id, order_id, item_id) VALUES ('${LINE}', '${ORDER}', '${ITEM}');
INSERT INTO public.declutter_offers VALUES ('${OFFER}', '${ITEM}', '${BUYER}', '${SELLER}'),
  ('${OTHER_OFFER}', '${ITEM}', '${STRANGER}', '${SELLER}');
`);
for (const fn of ["declutter_notice_type", "declutter_notice_link", "declutter_notice_about", "declutter_notice_names_item",
  "declutter_notice_ref", "declutter_notice_order_link", "declutter_notify_strict", "declutter_notify"]) {
  await db.exec(definitionBefore(fn, NEW_FILE));
}
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
const q = async (s, p) => (await db.query(s, p)).rows;

/** One notice through declutter_notify, after declutter_notice_ref(ref) as the Q2659 callers do. */
async function send({ to, other, link, ref = OFFER, order = null, title = "New offer", then = null }) {
  await q(`DELETE FROM public.notifications`);
  await db.transaction(async (tx) => {
    if (order !== null) await tx.query(`SELECT set_config('declutter.notice_order', $1, true)`, [order]);
    if (ref !== null) await tx.query(`SELECT set_config('declutter.notice_ref', $1, true)`, [ref]);
    await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', $2, 'You got a $30 offer.', $3, $4::uuid)`,
      [to, title, link, other]);
    if (then) await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'Offer answered automatically', 'x', $2, $3::uuid)`,
      [then.to, then.link, then.other]);
  });
  return q(`SELECT type, title, message, link, declutter_ref FROM public.notifications ORDER BY id`);
}

// The real calls go through declutter_notice_ref (a uuid argument); one call through it proves the setting's name.
await q(`DELETE FROM public.notifications`);
await db.transaction(async (tx) => {
  await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [OFFER]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'New offer', 'You got a $30 offer.', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
});
const viaRef = (await q(`SELECT link FROM public.notifications`))[0];
check("through declutter_notice_ref: the seller's New offer opens the offer", viaRef?.link === `/declutter?tab=selling&offer=${OFFER}`, JSON.stringify(viaRef));

const [sellerRow] = await send({ to: SELLER, other: BUYER, link: "/declutter?tab=selling" });
check("the seller's New offer opens the offer", sellerRow?.link === `/declutter?tab=selling&offer=${OFFER}`, JSON.stringify(sellerRow));
check("the notice keeps its declutter_ref (Q2659)", sellerRow?.declutter_ref === OFFER, JSON.stringify(sellerRow));
// No order is recorded for an offer, so the writer names no item in front (the real offer messages name it inline).
check("the message is written as sent", sellerRow?.message === "You got a $30 offer.", JSON.stringify(sellerRow));
const [buyerRow] = await send({ to: BUYER, other: SELLER, link: "/declutter?tab=buying", title: "New counteroffer" });
check("the buyer's New counteroffer opens the offer", buyerRow?.link === `/declutter?tab=buying&offer=${OFFER}`, JSON.stringify(buyerRow));
const [otherRow] = await send({ to: SELLER, other: STRANGER, link: "/declutter?tab=selling", ref: OTHER_OFFER });
check("another offer's notice carries that offer, never the first one", otherRow?.link === `/declutter?tab=selling&offer=${OTHER_OFFER}`, JSON.stringify(otherRow));

const kept = [
  ["the seller sent the buyer's tab", { to: SELLER, other: BUYER, link: "/declutter?tab=buying" }],
  ["the buyer sent the seller's tab", { to: BUYER, other: SELLER, link: "/declutter?tab=selling" }],
  ["a link with more query", { to: SELLER, other: BUYER, link: "/declutter?tab=selling&talk=abc" }],
  ["an item page", { to: SELLER, other: BUYER, link: `/declutter/item/${ITEM}` }],
  ["a counterpart who is not this offer's other party", { to: SELLER, other: STRANGER, link: "/declutter?tab=selling" }],
  ["no counterpart", { to: SELLER, other: null, link: "/declutter?tab=selling" }],
  ["no ref", { to: SELLER, other: BUYER, link: "/declutter?tab=selling", ref: null }],
  ["a ref that is a cart line, not an offer", { to: SELLER, other: BUYER, link: "/declutter?tab=selling", ref: LINE }],
  ["a malformed ref", { to: SELLER, other: BUYER, link: "/declutter?tab=selling", ref: "x' OR 1=1" }],
];
for (const [name, args] of kept) {
  const [row] = await send(args);
  check(`${name}: the link is unchanged`, row?.link === args.link, JSON.stringify(row));
}

const pair = await send({ to: BUYER, other: SELLER, link: "/declutter?tab=buying", title: "New counteroffer",
  then: { to: SELLER, other: BUYER, link: "/declutter?tab=selling" } });
check("one notice only: the counter opens the offer", pair[0]?.link === `/declutter?tab=buying&offer=${OFFER}`, JSON.stringify(pair[0]));
check("one notice only: the next notice, with no ref of its own, does not", pair[1]?.link === "/declutter?tab=selling", JSON.stringify(pair[1]));

const [orderRow] = await send({ to: SELLER, other: BUYER, link: "/declutter?tab=selling", ref: null, order: ORDER, title: "Refund request" });
check("BUY-30 unchanged: an order notice still opens the order", orderRow?.link === `/declutter?tab=selling&order=${ORDER}`, JSON.stringify(orderRow));
const [lineRow] = await send({ to: SELLER, other: BUYER, link: "/declutter?tab=selling", ref: LINE, order: ORDER, title: "Sold: waiting for the buyer to pay" });
check("BUY-30 unchanged: a cart-line notice in an order still opens the order", lineRow?.link === `/declutter?tab=selling&order=${ORDER}`, JSON.stringify(lineRow));

const defects = await q(`SELECT * FROM public.defects`);
check("no notice was lost (log_cron_defect never called)", defects.length === 0, JSON.stringify(defects));

const acl = (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure('public.declutter_notice_order_link(uuid,uuid,text)')`))[0]?.a ?? "MISSING";
check("declutter_notice_order_link stays service_role only", /service_role=X/.test(acl) && !/(anon|authenticated)=X/.test(acl) && !/[{,]=X/.test(acl), acl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
