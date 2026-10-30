#!/usr/bin/env node
/**
 * PGlite proof for 20261030152217_declutter_offer_expired_names_item (E2-7): both "Offer expired" notices name the item.
 *
 *   node src/test/pglite/declutterOfferExpiredNamesItem.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOfferExpiredNamesItem.pglite.mjs # RED: the previous body
 *   MUTANT=<name> node src/test/pglite/declutterOfferExpiredNamesItem.pglite.mjs      # a planted defect: must FAIL
 *
 * World, and what is stubbed (said so): the tables the sweep touches, with only the columns it reads; declutter_notify
 * records each notice in a table; the pair, seller-out, feature, strike and cron-defect helpers are stubs. The sweep
 * is the real body: this migration's, or with NEW_MIGRATION=skip the newest definition before it (read from the files).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261030152217_declutter_offer_expired_names_item.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The title is never read, so every notice falls back to the old words.
  noTitle: [`(SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title`, `NULL::text AS title`],
  // No fallback: an offer with no item row gets a NULL message.
  noFallback: [`CASE WHEN r.title IS NULL THEN\n             CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'\n                  ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END\n           WHEN`, `CASE WHEN`],
  // The buyer's side swapped: told they ignored it when the seller did.
  swapped: [`WHEN r.awaiting = 'seller' THEN format('The seller did not answer your offer on`, `WHEN r.awaiting <> 'seller' THEN format('The seller did not answer your offer on`],
  // The seller's notice goes back to words naming no item.
  sellerWords: [`ELSE format('The buyer did not answer your counteroffer on "%s" within 48 hours, so it closed.', r.title) END,`, `ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END,`],
};
const skip = process.env.NEW_MIGRATION === "skip";

function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, sql: `${sql.slice(m.index, end + t[1].length)};
REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.${name}() TO service_role;` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `44444444-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER_A = U(2), BUYER_B = U(3), BUYER_C = U(4), BUYER_D = U(5);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text NOT NULL, status text NOT NULL DEFAULT 'live',
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    item_id uuid, awaiting text, status text, respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text,
    closed_at timestamptz);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    item_id uuid, order_id uuid, status text NOT NULL DEFAULT 'in_cart', checkout_by timestamptz NOT NULL, price_cents int,
    source text, reminded_24h_at timestamptz, reminded_2h_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_handover_talks (buyer_id uuid, seller_id uuid, opened_at timestamptz DEFAULT now(),
    closed_at timestamptz, expires_at timestamptz DEFAULT now() + interval '72 hours');
  CREATE TABLE public.notices (user_id uuid, kind text, title text, message text, link text, other uuid);
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_kind, p_title, p_message, p_link, p_other) $$;
  CREATE FUNCTION public.declutter_pair_talking(p_buyer uuid, p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_pair_needs_talk(p_buyer uuid, p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_seller_out(p_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
    RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
`);

const prev = newestBefore("declutter_deadline_sweep", THIS);
console.log(`base: declutter_deadline_sweep from ${prev.file}`);
await db.exec(prev.sql);
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

await db.exec(`
  INSERT INTO public.declutter_items (id, title) VALUES ('${I(1)}', 'Oak rocking chair'), ('${I(2)}', 'Blue table lamp'), ('${I(3)}', 'Kept open');
  INSERT INTO public.declutter_offers (buyer_id, seller_id, item_id, awaiting, status, respond_by) VALUES
    ('${BUYER_A}', '${SELLER}', '${I(1)}', 'seller', 'open', now() - interval '1 minute'),
    ('${BUYER_B}', '${SELLER}', '${I(2)}', 'buyer',  'open', now() - interval '1 minute'),
    ('${BUYER_C}', '${SELLER}', NULL,      'seller', 'open', now() - interval '1 minute'),
    ('${BUYER_D}', '${SELLER}', '${I(3)}', 'seller', 'open', now() + interval '1 hour');
`);
const out = (await db.query(`SELECT public.declutter_deadline_sweep() AS r`)).rows[0].r;
const notices = (await db.query(`SELECT user_id, kind, title, message, link FROM public.notices`)).rows;
const defects = (await db.query(`SELECT * FROM public.cron_defects_seen`)).rows;
const msg = (u) => notices.filter((n) => n.user_id === u).map((n) => n.message);
const sellerMsgs = msg(SELLER);

check(defects.length === 0 && out.offers_expired === 3, `3 offers expired, no defects (${out.offers_expired}, ${defects.length})`);
check(msg(BUYER_A)[0] === 'The seller did not answer your offer on "Oak rocking chair" within 48 hours, so it closed. Nothing was charged.',
  `buyer whose offer the seller ignored is told the item (${msg(BUYER_A)[0]})`);
check(msg(BUYER_B)[0] === 'You did not answer the counteroffer on "Blue table lamp" within 48 hours, so it closed.',
  `buyer who ignored a counter is told the item (${msg(BUYER_B)[0]})`);
check(sellerMsgs.includes('You did not answer an offer on "Oak rocking chair" within 48 hours, so it closed.'),
  `seller who ignored an offer is told the item`);
check(sellerMsgs.includes('The buyer did not answer your counteroffer on "Blue table lamp" within 48 hours, so it closed.'),
  `seller whose counter was ignored is told the item`);
check(msg(BUYER_C)[0] === "The seller did not answer your offer within 48 hours, so it closed. Nothing was charged."
  && sellerMsgs.includes("You did not answer an offer within 48 hours, so it closed."),
  `an offer with no item row keeps the old words, never a blank (${msg(BUYER_C)[0]})`);
check(msg(BUYER_D).length === 0, "an offer still inside its 48 hours gets no notice");
check(notices.every((n) => n.kind === "expired" && n.title === "Offer expired"), "kind and title unchanged, so the notice stays under declutter_offers");
check(notices.filter((n) => n.user_id === SELLER).every((n) => n.link === "/declutter?tab=selling")
  && notices.find((n) => n.user_id === BUYER_A).link === `/declutter/item/${I(1)}`, "links unchanged");
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_deadline_sweep()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_deadline_sweep()', 'EXECUTE') AS u,
  has_function_privilege('service_role', 'public.declutter_deadline_sweep()', 'EXECUTE') AS s`)).rows[0];
check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
