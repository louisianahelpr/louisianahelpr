#!/usr/bin/env node
/**
 * Declutter audit DC-18 + DB-19 (2026-10-30): a sale keeps its item's title after the listing is deleted, and ended
 * cards can show when they ended. Runs NEW_FILE VERBATIM (3x) on a prod-shaped fixture of the tables
 * public.declutter_my_cart reads, after the previous definition, then:
 *   - a line whose item still existed before the migration is backfilled, and keeps its title after the item is deleted;
 *   - a line created after the migration (by a role with no read on declutter_items and no EXECUTE on the trigger
 *     function) gets its title, and keeps it after the item is deleted (FK ON DELETE SET NULL);
 *   - the title is refreshed on a status change while the item exists (title at the moment of sale);
 *   - a line whose item was already gone says "A listing that was taken down" while the seller still has an account,
 *     and "An item from a former member" only when the seller's account is gone (seller_id NULL);
 *   - declutter_my_cart returns each line's price and closed_at;
 *   - the trigger function is executable by nobody but its owner; my_cart keeps prod's grants.
 *
 *   node src/test/pglite/declutterCartKeepsItemTitle.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCartKeepsItemTitle.pglite.mjs   # RED: the previous definition
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_cart_keeps_item_title.sql"));
if (!NEW_FILE) throw new Error("the DC-18 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definition (expect FAILs)");

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

const SELLER = "99999999-0000-0000-0000-000000000000";
const BUYER = "99999999-0000-0000-0000-000000000001";
const I_OLD = "aaaaaaaa-0000-0000-0000-000000000001"; // exists before the migration; deleted after it
const I_NEW = "aaaaaaaa-0000-0000-0000-000000000002"; // line created after the migration; then deleted
const I_REN = "aaaaaaaa-0000-0000-0000-000000000003"; // renamed while in the cart, then paid
const L_OLD = "bbbbbbbb-0000-0000-0000-000000000001";
const L_GONE = "bbbbbbbb-0000-0000-0000-000000000002"; // item already deleted before the migration, seller present
const L_FORMER = "bbbbbbbb-0000-0000-0000-000000000003"; // item and seller account gone
const L_NEW = "bbbbbbbb-0000-0000-0000-000000000004";
const L_REN = "bbbbbbbb-0000-0000-0000-000000000005";

const db = new PGlite();
// Prod shape (information_schema / pg_constraint, 2026-10-30): item_id ON DELETE SET NULL; authenticated has SELECT only.
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, status text,
  porch_ok boolean DEFAULT true, handovers text[]);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, handover text,
  premium_cents integer, total_cents integer, delivery_cents integer);
CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES public.declutter_items(id) ON DELETE SET NULL, buyer_id uuid, seller_id uuid,
  price_cents integer, source text CHECK (source IN ('offer', 'buy')), offer_id uuid, order_id uuid, status text, checkout_by timestamptz,
  reminded_24h_at timestamptz, reminded_2h_at timestamptz, is_seed boolean DEFAULT false,
  created_at timestamptz DEFAULT now() - interval '3 days', closed_at timestamptz, list_price_cents integer);
GRANT SELECT ON public.declutter_cart_items TO authenticated;
INSERT INTO public.declutter_items (id, seller_id, title, status) VALUES
  ('${I_OLD}', '${SELLER}', 'Oak chair', 'sold'),
  ('${I_NEW}', '${SELLER}', 'Brass lamp', 'live'),
  ('${I_REN}', '${SELLER}', 'Blue rug', 'reserved');
INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents, source, status, checkout_by, closed_at) VALUES
  ('${L_OLD}', '${I_OLD}', '${BUYER}', '${SELLER}', 4000, 'buy', 'cancelled_by_seller', now(), '2026-10-29 15:00+00'),
  ('${L_GONE}', NULL, '${BUYER}', '${SELLER}', 1200, 'buy', 'missed', now(), '2026-10-28 15:00+00'),
  ('${L_FORMER}', NULL, '${BUYER}', NULL, 900, 'buy', 'paid', now(), '2026-10-27 15:00+00');
`);

await db.exec(definitionBefore("declutter_my_cart", NEW_FILE));
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
const q = async (s, p) => (await db.query(s, p)).rows;

// After the migration: a new line is created by a member-level role (as the RPCs' inserts would, minus the definer).
await db.exec(`GRANT INSERT, UPDATE ON public.declutter_cart_items TO authenticated;`);
let insertError = "";
try {
  await db.exec(`SET ROLE authenticated;
    INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${L_NEW}', '${I_NEW}', '${BUYER}', '${SELLER}', 2500, 'offer', 'in_cart', now() + interval '2 days'),
           ('${L_REN}', '${I_REN}', '${BUYER}', '${SELLER}', 1800, 'buy', 'in_cart', now() + interval '2 days');
    RESET ROLE;`);
} catch (e) {
  insertError = e.message;
  await db.exec(`RESET ROLE;`);
}
check("a member-level role can still create a cart line (the trigger needs no grant from it)", insertError === "", insertError);

// Renamed while in the cart, then paid: the kept title is the one at the moment of sale.
await db.exec(`UPDATE public.declutter_items SET title = 'Navy rug' WHERE id = '${I_REN}';
  UPDATE public.declutter_cart_items SET status = 'paid', closed_at = '2026-10-30 12:00+00' WHERE id = '${L_REN}';
  UPDATE public.declutter_cart_items SET status = 'paid', closed_at = '2026-10-30 11:00+00' WHERE id = '${L_NEW}';`);
// The sellers delete the listings (FK sets item_id NULL on every line).
await db.exec(`DELETE FROM public.declutter_items WHERE id IN ('${I_OLD}', '${I_NEW}', '${I_REN}');`);

await q(`SELECT set_config('test.uid', $1, false)`, [BUYER]);
let cart = [];
try {
  cart = await q(`SELECT * FROM public.declutter_my_cart()`);
} catch (e) {
  check("declutter_my_cart runs", false, e.message);
}
const line = (id) => cart.find((r) => r.line_id === id);
check("the backfilled line keeps its title after its listing is deleted", line(L_OLD)?.item_title === "Oak chair", JSON.stringify(line(L_OLD)));
check("a line created after the migration keeps its title after its listing is deleted", line(L_NEW)?.item_title === "Brass lamp", JSON.stringify(line(L_NEW)));
check("the kept title is the one at the moment of sale (renamed in the cart, then paid)", line(L_REN)?.item_title === "Navy rug", JSON.stringify(line(L_REN)));
check("a line whose listing was already gone does not call a present seller a former member",
  line(L_GONE)?.item_title === "A listing that was taken down", JSON.stringify(line(L_GONE)));
check("a line whose seller deleted their account still reads as an item from a former member (Q2307)",
  line(L_FORMER)?.item_title === "An item from a former member", JSON.stringify(line(L_FORMER)));
check("ended lines carry their price", line(L_OLD)?.price_cents === 4000 && line(L_GONE)?.price_cents === 1200, JSON.stringify(cart.map((r) => r.price_cents)));
check("ended lines carry the date they ended (closed_at)",
  line(L_OLD)?.closed_at instanceof Date && line(L_OLD).closed_at.toISOString() === "2026-10-29T15:00:00.000Z", String(line(L_OLD)?.closed_at));
check("DB-5's source column is still returned", line(L_NEW)?.source === "offer", JSON.stringify(line(L_NEW)));

// The seller's side reads the same kept title.
await q(`SELECT set_config('test.uid', $1, false)`, [SELLER]);
const sellerCart = await q(`SELECT line_id, item_title, my_side FROM public.declutter_my_cart()`).catch((e) => (check("seller my_cart runs", false, e.message), []));
const sOld = sellerCart.find((r) => r.line_id === L_OLD);
check("the seller's Selling history shows the kept title, not 'a former member'", sOld?.item_title === "Oak chair" && sOld?.my_side === "seller", JSON.stringify(sOld));

// Grants.
const acl = async (sig) => (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig]))[0]?.a ?? "MISSING";
const trigAcl = await acl("public.declutter_cart_item_keep_title()");
check("the trigger function exists and is executable by nobody but its owner",
  trigAcl !== "MISSING" && trigAcl !== "" && !/(^|[{,])(anon|authenticated|service_role)?=X/.test(trigAcl), trigAcl);
const cartAcl = await acl("public.declutter_my_cart()");
check("declutter_my_cart keeps prod's grants (authenticated, service_role; not PUBLIC or anon)",
  /authenticated=X/.test(cartAcl) && /service_role=X/.test(cartAcl) && !/anon=X/.test(cartAcl) && !/[{,]=X/.test(cartAcl), cartAcl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
