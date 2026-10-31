#!/usr/bin/env node
/**
 * PGlite proof for 20261031083708_declutter_edit_tells_offer_holders_what_matters (BUY-11, buying audit 10-30 #11).
 *
 *   node src/test/pglite/declutterEditTellsOfferHolders.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterEditTellsOfferHolders.pglite.mjs  # RED: the newest before it
 *
 * World: declutter_items / declutter_item_private / declutter_tax_attestations / declutter_offers with the columns
 * the function touches (no triggers), and declutter_edit_listing: the newest CREATE before this migration (SKIP) or
 * this migration's file, run verbatim 3 times. Stubbed, and said so: require_feature (no-op), is_caller_banned
 * (false), declutter_assert_member (the GUC test.uid), declutter_notify (records the row in a table). Not read
 * against prod. [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031083708_declutter_edit_tells_offer_holders_what_matters.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag), with its REVOKE/GRANT. */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const SELLER = "33333333-3333-3333-3333-333333333333";
const BUYER = "44444444-4444-4444-4444-444444444444";
const BUYER2 = "55555555-5555-5555-5555-555555555555";
const ITEM = "c0000000-0000-0000-0000-000000000001";

const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text, description text,
    category text, condition_stars integer, delivery_size text, handovers text[], porch_ok boolean, price_cents integer,
    submitted_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_flag_reason text, updated_at timestamptz);
  CREATE TABLE public.declutter_tax_attestations (item_id uuid PRIMARY KEY, seller_id uuid, bought_for_personal_use boolean,
    not_in_the_business boolean, not_a_frequent_seller boolean, keeps_item_until_handover boolean, attested_at timestamptz);
  CREATE TABLE public.declutter_offers (id bigserial PRIMARY KEY, item_id uuid, buyer_id uuid, status text);
  CREATE TABLE public.sent (user_id uuid, kind text, title text, body text, link text);
  CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.uid')::uuid $$;
  CREATE FUNCTION public.declutter_notify(u uuid, k text, t text, b text, l text, actor uuid) RETURNS void LANGUAGE sql AS
    $$ INSERT INTO public.sent VALUES (u, k, t, b, l) $$;
  INSERT INTO public.declutter_items VALUES ('${ITEM}', '${SELLER}', 'live', 'Oak chair', 'Sturdy.', 'furniture', 5, 'medium',
    ARRAY['delivery','porch'], true, 4000, now(), now());
  INSERT INTO public.declutter_item_private VALUES ('${ITEM}', now(), NULL, now());
  INSERT INTO public.declutter_offers (item_id, buyer_id, status) VALUES ('${ITEM}', '${BUYER}', 'open'), ('${ITEM}', '${BUYER2}', 'declined');
`);

const fnSql = SKIP ? newest("declutter_edit_listing").sql : readFileSync(MIG_DIR + THIS, "utf8");
for (let i = 0; i < (SKIP ? 1 : 3); i++) await db.exec(fnSql);
console.log(SKIP ? `before: ${newest("declutter_edit_listing").file}` : `after: ${THIS}, applied 3x`);
await db.exec(`SET test.uid = '${SELLER}'`);

async function edit({ title = "Oak chair", description = "Sturdy.", category = "furniture", stars = 5, size = "medium", ways = "ARRAY['delivery','porch']" }) {
  await db.exec("DELETE FROM public.sent");
  const r = await db.query(`SELECT public.declutter_edit_listing('${ITEM}', '${title}', '${description}', '${category}', ${stars}, '${size}', ${ways}, true, true, true, true) AS r`);
  const sent = (await db.query("SELECT * FROM public.sent")).rows;
  const status = (await db.query(`SELECT status FROM public.declutter_items WHERE id = '${ITEM}'`)).rows[0].status;
  return { r: r.rows[0].r, sent, status };
}

const same = await edit({});
check(same.r === "live" && same.sent.length === 0, "[keep] saving with nothing changed tells nobody");
const stars = await edit({ stars: 1 });
check(stars.r === "live" && stars.status === "live", "[keep] a condition change is a small edit: the item stays live, no re-check");
check(stars.sent.length === 1 && stars.sent[0].user_id === BUYER && /changed the condition on "Oak chair"/.test(stars.sent[0].body),
  `[fix] the open-offer buyer is told the condition changed (only them): ${JSON.stringify(stars.sent.map((s) => s.body))}`);
const size = await edit({ stars: 1, size: "large" });
check(size.sent.length === 1 && /changed the size on/.test(size.sent[0].body) && size.sent[0].link === `/declutter/item/${ITEM}`,
  "[fix] a size change (the delivery price) is told, linking the item");
const ways = await edit({ stars: 1, size: "large", ways: "ARRAY['delivery']" });
check(ways.sent.length === 1 && /changed the ways to get it on/.test(ways.sent[0].body), "[fix] porch taken away is told");
const two = await edit({ stars: 3, size: "small", ways: "ARRAY['delivery']" });
const three = await edit({ stars: 2, size: "medium", ways: "ARRAY['delivery','porch']" });
check(three.sent.length === 1 && /changed the condition, size and ways to get it on/.test(three.sent[0].body), "[fix] three changes: named in one sentence");
check(two.sent.length === 1 && /changed the condition and size on/.test(two.sent[0].body), "[fix] two changes at once: one notice naming both");
const offerOpen = (await db.query(`SELECT status FROM public.declutter_offers WHERE buyer_id = '${BUYER}'`)).rows[0].status;
check(offerOpen === "open", "[keep] the offer stays open");
const big = await edit({ stars: 3, size: "small", ways: "ARRAY['delivery']", title: "Oak rocking chair" });
check(big.r === "pending_review" && big.sent.length === 1 && /The seller updated "Oak rocking chair"/.test(big.sent[0].body),
  "[keep] a big edit still re-checks and sends its own notice once");
const acl = await db.query("SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'declutter_edit_listing'");
check(SKIP || (!/(^|[{,])anon=/.test(acl.rows[0].acl ?? "") && !/(^|[{,])=X/.test(acl.rows[0].acl ?? "")), "[keep] no EXECUTE for PUBLIC or anon");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
