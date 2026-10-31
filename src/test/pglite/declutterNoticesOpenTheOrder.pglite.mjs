#!/usr/bin/env node
/**
 * BUY-30 (2026-10-31): a Declutter notice about one order opens that order. Runs NEW_FILE VERBATIM (3x) after the
 * previous definitions of the writer (declutter_notice_type, declutter_notice_link, declutter_notice_about,
 * declutter_notice_names_item, declutter_notify_strict, declutter_notify), then writes notices through
 * declutter_notify (the path every sender uses) inside a transaction that recorded an order, and reads the stored link:
 *   - the order's seller, sent ?tab=selling about the buyer: ?tab=selling&order=<id>;
 *   - the order's buyer, sent ?tab=buying (or an old ?view=bought, rewritten first): ?tab=buying&order=<id>;
 *   - the other side's tab, a link with more query (&talk=), a sub-view, an item page, a non-Declutter link: unchanged;
 *   - a counterpart who is not this order's other party, no counterpart, no order recorded, a malformed
 *     recorded value: unchanged (never another order's id);
 *   - the item is still named in front of the message, and the notice's kind is unchanged;
 *   - grants: declutter_notice_order_link and declutter_notify_strict are service_role only.
 * Stubbed, and said so: declutter_price_words returns the message; log_cron_defect does nothing.
 *
 *   node src/test/pglite/declutterNoticesOpenTheOrder.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticesOpenTheOrder.pglite.mjs   # RED: the previous writer
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_notices_open_the_order.sql"));
if (!NEW_FILE) throw new Error("the BUY-30 order-link migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS writer (expect FAILs)");

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
const ORDER = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ORDER = "aaaaaaaa-0000-4000-8000-000000000002";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, type text, title text, message text, link text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, order_id uuid, item_id uuid, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.profiles (user_id) VALUES ('${SELLER}'), ('${BUYER}'), ('${STRANGER}');
INSERT INTO public.declutter_orders VALUES ('${ORDER}', '${BUYER}', '${SELLER}'), ('${OTHER_ORDER}', '${STRANGER}', '${SELLER}');
INSERT INTO public.declutter_items VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'Oak chair');
INSERT INTO public.declutter_cart_items (id, order_id, item_id)
  VALUES ('cccccccc-0000-4000-8000-000000000001', '${ORDER}', 'bbbbbbbb-0000-4000-8000-000000000001');
`);
for (const fn of ["declutter_notice_type", "declutter_notice_link", "declutter_notice_about", "declutter_notice_names_item",
  "declutter_notify_strict", "declutter_notify"]) {
  await db.exec(definitionBefore(fn, NEW_FILE));
}
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
const q = async (s, p) => (await db.query(s, p)).rows;

/** One notice through declutter_notify, in a transaction that recorded `about` (as declutter_lock_order does). */
async function send({ to, other, link, about = ORDER, title = "Refund request", type = "payment" }) {
  await q(`DELETE FROM public.notifications`);
  await db.transaction(async (tx) => {
    if (about !== null) await tx.query(`SELECT set_config('declutter.notice_order', $1, true)`, [about]);
    await tx.query(`SELECT public.declutter_notify($1::uuid, $2, $3, 'The buyer asked for a refund.', $4, $5::uuid)`,
      [to, type, title, link, other]);
  });
  return (await q(`SELECT type, message, link FROM public.notifications`))[0];
}

const opened = [
  ["the seller, ?tab=selling", { to: SELLER, other: BUYER, link: "/declutter?tab=selling" }, `/declutter?tab=selling&order=${ORDER}`],
  ["the buyer, ?tab=buying", { to: BUYER, other: SELLER, link: "/declutter?tab=buying" }, `/declutter?tab=buying&order=${ORDER}`],
  ["the buyer, an old ?view=bought", { to: BUYER, other: SELLER, link: "/declutter?view=bought" }, `/declutter?tab=buying&order=${ORDER}`],
  ["the seller, an old ?view=sales", { to: SELLER, other: BUYER, link: "/declutter?view=sales" }, `/declutter?tab=selling&order=${ORDER}`],
];
for (const [name, args, want] of opened) {
  const row = await send(args);
  check(`${name} opens the order`, row?.link === want, JSON.stringify(row));
}

const kept = [
  ["the seller sent the buyer's tab", { to: SELLER, other: BUYER, link: "/declutter?tab=buying" }],
  ["the buyer sent the seller's tab", { to: BUYER, other: SELLER, link: "/declutter?tab=selling" }],
  ["a link with more query", { to: SELLER, other: BUYER, link: "/declutter?tab=selling&talk=abc" }],
  ["a sub-view", { to: SELLER, other: BUYER, link: "/declutter?view=deliver" }],
  ["an item page", { to: SELLER, other: BUYER, link: "/declutter/item/abc" }],
  ["a non-Declutter link", { to: SELLER, other: BUYER, link: "/earnings" }],
  ["a counterpart who is not this order's other party", { to: SELLER, other: STRANGER, link: "/declutter?tab=selling" }],
  ["no counterpart", { to: SELLER, other: null, link: "/declutter?tab=selling" }],
  ["no order recorded", { to: SELLER, other: BUYER, link: "/declutter?tab=selling", about: null }],
  ["a malformed recorded value", { to: SELLER, other: BUYER, link: "/declutter?tab=selling", about: "x' OR 1=1" }],
];
for (const [name, args] of kept) {
  const row = await send(args);
  const want = args.link === "/declutter?view=deliver" ? "/declutter?view=deliver" : args.link;
  check(`${name}: the link is unchanged`, row?.link === want, JSON.stringify(row));
}
const other = await send({ to: SELLER, other: STRANGER, link: "/declutter?tab=selling", about: OTHER_ORDER });
check("another order's notice carries that order, never the first one",
  other?.link === `/declutter?tab=selling&order=${OTHER_ORDER}`, JSON.stringify(other));

const named = await send({ to: SELLER, other: BUYER, link: "/declutter?tab=selling" });
check("the item is still named in front of the message", named?.message === "Oak chair: The buyer asked for a refund.", JSON.stringify(named));
check("the notice's kind is unchanged (a refund notice)", named?.type === "declutter_refunds", JSON.stringify(named));
const nul = await send({ to: SELLER, other: BUYER, link: null });
check("a notice with no link is still written, with no link", nul !== undefined && nul.link === null, JSON.stringify(nul));

const acl = async (sig) => (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig]))[0]?.a ?? "MISSING";
const only = (a) => /service_role=X/.test(a) && !/(anon|authenticated)=X/.test(a) && !/[{,]=X/.test(a);
const linkAcl = await acl("public.declutter_notice_order_link(uuid,uuid,text)");
check("declutter_notice_order_link exists and is service_role only", only(linkAcl), linkAcl);
const strictAcl = await acl("public.declutter_notify_strict(uuid,text,text,text,text,uuid)");
check("declutter_notify_strict stays service_role only (as prod)", only(strictAcl), strictAcl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
