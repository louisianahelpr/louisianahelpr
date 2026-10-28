#!/usr/bin/env node
/**
 * PGlite proof for 20261028221904_declutter_remove_cart_item (Declutter audit 2 B2-4 / lead A2-8: a buyer can take an
 * item out of their cart).
 *
 *   node src/test/pglite/declutterRemoveCartItem.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRemoveCartItem.pglite.mjs # RED: before it, nothing removes a line
 *
 * The migration runs verbatim on prod-shaped stubs: require_feature (feature_disabled 42501), declutter_seller_out,
 * declutter_notify (records the notice), and the cart, order and item tables with their live CHECKs for status.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261028221904_declutter_remove_cart_item.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: before the migration (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const BUYER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const SELLER = "00000000-0000-4000-8000-0000000000a1";
const OUT = "00000000-0000-4000-8000-0000000000a2";
const I = (n) => `00000000-0000-4000-8000-00000000010${n}`;
const L = (n) => `00000000-0000-4000-8000-00000000020${n}`;
const O = (n) => `00000000-0000-4000-8000-00000000030${n}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TABLE public.switch_off (key text);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.switch_off s WHERE s.key = k) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE TABLE public.sellers_out (uid uuid);
  CREATE FUNCTION public.declutter_seller_out(p_seller uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.sellers_out s WHERE s.uid = p_seller) $$;
  CREATE TABLE public.notices (user_id uuid, title text, message text, link text, other uuid);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_message, p_link, p_other) $$;
  CREATE TABLE public.strikes (uid uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text NOT NULL, title text,
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid,
    status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'paid', 'superseded', 'expired')),
    close_reason text, stripe_checkout_session_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  -- The live table's status CHECK (20261014210518), by its default name.
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, item_id uuid NOT NULL, buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
    price_cents int NOT NULL, order_id uuid,
    status text NOT NULL DEFAULT 'in_cart' CHECK (status IN ('in_cart', 'paid', 'missed', 'cancelled_by_seller')),
    checkout_by timestamptz NOT NULL DEFAULT now() + interval '40 hours', created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  INSERT INTO public.sellers_out VALUES ('${OUT}');
  INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES
    ('${I(1)}', '${SELLER}', 'reserved', 'Lamp'),
    ('${I(2)}', '${SELLER}', 'reserved', 'Chair'),
    ('${I(3)}', '${SELLER}', 'reserved', 'Rug'),
    ('${I(4)}', '${SELLER}', 'reserved', 'Desk'),
    ('${I(5)}', '${OUT}', 'reserved', 'Mug'),
    ('${I(6)}', '${SELLER}', 'sold', 'Sold vase');
  -- o1: a page opened 5 minutes ago (live). o2: a page from 2 hours ago (dead), two lines. o3: paid.
  INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, stripe_checkout_session_id, created_at) VALUES
    ('${O(1)}', '${BUYER}', '${SELLER}', 'awaiting_payment', 'cs_live', now() - interval '5 minutes'),
    ('${O(2)}', '${BUYER}', '${SELLER}', 'awaiting_payment', 'cs_dead', now() - interval '2 hours'),
    ('${O(3)}', '${BUYER}', '${SELLER}', 'paid', 'cs_paid', now() - interval '1 day');
  INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents, order_id, status) VALUES
    ('${L(1)}', '${I(1)}', '${BUYER}', '${SELLER}', 2500, NULL, 'in_cart'),
    ('${L(2)}', '${I(2)}', '${BUYER}', '${SELLER}', 3000, '${O(1)}', 'in_cart'),
    ('${L(3)}', '${I(3)}', '${BUYER}', '${SELLER}', 1500, '${O(2)}', 'in_cart'),
    ('${L(4)}', '${I(4)}', '${BUYER}', '${SELLER}', 4000, '${O(2)}', 'in_cart'),
    ('${L(5)}', '${I(5)}', '${BUYER}', '${OUT}', 800, NULL, 'in_cart'),
    ('${L(6)}', '${I(6)}', '${BUYER}', '${SELLER}', 5000, '${O(3)}', 'paid');
`);

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
async function remove(uid, line) {
  await as(uid);
  try {
    const r = await db.query("SELECT public.declutter_remove_cart_item($1) AS s", [line]);
    return { ok: r.rows[0].s };
  } catch (e) {
    return { err: e.message };
  }
}
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const line = (id) => one("SELECT status, order_id, closed_at FROM public.declutter_cart_items WHERE id = $1", [id]);
const item = async (id) => (await one("SELECT status FROM public.declutter_items WHERE id = $1", [id])).status;
const order = (id) => one("SELECT status, close_reason FROM public.declutter_orders WHERE id = $1", [id]);
const notices = async () => (await db.query("SELECT user_id, title, message, link, other FROM public.notices")).rows;

// Who may remove.
let r = await remove(OTHER, L(1));
check("someone else can't remove a buyer's line (item_not_found, no oracle)", r.err === "item_not_found", JSON.stringify(r));
check("  the line is still in the cart and the item still reserved", (await line(L(1)))?.status === "in_cart" && (await item(I(1))) === "reserved");
r = await remove(SELLER, L(1));
check("the seller can't remove the buyer's line", r.err === "item_not_found", JSON.stringify(r));
r = await remove(null, L(1));
check("signed out: refused", r.err === "not_authenticated", JSON.stringify(r));
await db.exec("INSERT INTO public.switch_off VALUES ('declutter')");
r = await remove(BUYER, L(1));
check("switch off: refused with feature_disabled", r.err === "feature_disabled", JSON.stringify(r));
await db.exec("DELETE FROM public.switch_off");
r = await remove(BUYER, "00000000-0000-4000-8000-000000000999");
check("no such line: item_not_found", r.err === "item_not_found", JSON.stringify(r));

// The plain case: no checkout yet.
r = await remove(BUYER, L(1));
check("the buyer removes their own in-cart line", r.ok === "removed", JSON.stringify(r));
let l1 = await line(L(1));
check("  the line is 'removed' and closed", l1?.status === "removed" && l1.closed_at !== null, JSON.stringify(l1));
check("  the item is back on sale (reserved -> live)", (await item(I(1))) === "live");
let n = await notices();
check("  the seller is told it is back on sale, naming the item, opening Selling",
  n.length === 1 && n[0].user_id === SELLER && n[0].title === "Back on sale" && n[0].message.includes('"Lamp"')
    && n[0].link === "/declutter?tab=selling" && n[0].other === BUYER, JSON.stringify(n));
check("  no strike for the buyer", (await one("SELECT count(*)::int AS c FROM public.strikes")).c === 0);
r = await remove(BUYER, L(1));
check("a repeat answers 'already' and changes nothing", r.ok === "already" && (await notices()).length === 1, JSON.stringify(r));

// A live Stripe page.
r = await remove(BUYER, L(2));
check("a line whose checkout page is still payable is refused (checkout_open)", r.err === "checkout_open", JSON.stringify(r));
check("  nothing changed: line in cart, item reserved, order awaiting payment",
  (await line(L(2))).status === "in_cart" && (await item(I(2))) === "reserved" && (await order(O(1))).status === "awaiting_payment");

// A dead page with two lines: the order is superseded, the other line is let go of it.
r = await remove(BUYER, L(3));
check("a line whose checkout page has died is removed", r.ok === "removed", JSON.stringify(r));
const o2 = await order(O(2));
check("  its order is superseded (a late payment is refunded by declutter_mark_order_paid)",
  o2.status === "superseded" && o2.close_reason === "superseded", JSON.stringify(o2));
const l4 = await line(L(4));
check("  the order's other line stays in the cart, free of the dead order", l4.status === "in_cart" && l4.order_id === null, JSON.stringify(l4));
check("  only the removed line's item goes back on sale", (await item(I(3))) === "live" && (await item(I(4))) === "reserved");

// A paid line, and a seller who is out.
r = await remove(BUYER, L(6));
check("a paid line is not in the cart (not_in_cart)", r.err === "not_in_cart", JSON.stringify(r));
check("  the paid order and item are untouched", (await order(O(3))).status === "paid" && (await item(I(6))) === "sold");
const before = (await notices()).length;
r = await remove(BUYER, L(5));
check("a line from a seller who can no longer sell is removed", r.ok === "removed", JSON.stringify(r));
check("  its item ends (as the deadline sweep does), with no back-on-sale notice",
  (await item(I(5))) === "ended" && (await notices()).length === before);

// Grants.
const acl = (await one("SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_remove_cart_item'"))?.a ?? "";
check("authenticated may call it; PUBLIC and anon may not",
  acl.includes("authenticated=X") && !acl.includes("anon=X") && !/(^|[{,])=X/.test(acl), acl);
const def = (await one("SELECT prosecdef AS d, proconfig::text AS c FROM pg_proc WHERE proname = 'declutter_remove_cart_item'")) ?? {};
check("SECURITY DEFINER with search_path pinned", def.d === true && /search_path/.test(def.c ?? ""), JSON.stringify(def));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
