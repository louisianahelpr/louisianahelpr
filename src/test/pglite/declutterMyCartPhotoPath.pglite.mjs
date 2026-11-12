#!/usr/bin/env node
/**
 * PGlite proof for 20261112054500 (audit 11-10 F372): declutter_my_cart carries photo_path, each line's item's FIRST
 * photo (lowest position), so Declutter order cards show the item photo. Only the line's own buyer or seller gets the
 * row; a line whose item or photos are gone reads NULL. Everything else the read returns is unchanged.
 *
 *   node src/test/pglite/declutterMyCartPhotoPath.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyCartPhotoPath.pglite.mjs # RED: no photo_path
 *   MUTANT=anyPhoto|lastPhoto|otherItem node ...                                # each must FAIL
 *
 * World: the PREVIOUS declutter_my_cart (20261108195151) created first on cut-down tables carrying the columns it
 * reads, then this migration 3x. Stubbed, and said so: seed_hidden_in_discovery() is true.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_my_cart_photo_path.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s);
  return t.slice(s, t.indexOf(`${tag};`, open + tag.length + 4) + tag.length + 1);
}
const prev = fnFrom("20261108195151_declutter_trades_fixes.sql", "CREATE OR REPLACE FUNCTION public.declutter_my_cart()");

const MUTANTS = {
  anyPhoto: ["           WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)", "           ORDER BY ph.position LIMIT 1)"],
  lastPhoto: ["           WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)", "           WHERE ph.item_id = c.item_id ORDER BY ph.position DESC LIMIT 1)"],
  otherItem: ["           WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)", "           WHERE ph.item_id <> c.item_id ORDER BY ph.position LIMIT 1)"],
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
const SAM = U(1), ANN = U(2), EVE = U(3);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O1 = "33333333-0000-0000-0000-000000000001";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text, porch_ok boolean, handovers text[], is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL,
    storage_path text NOT NULL UNIQUE, position integer NOT NULL, UNIQUE (item_id, position));
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text, handover text, premium_cents integer,
    total_cents integer, delivery_cents integer);
  CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, item_title text,
    seller_id uuid, buyer_id uuid, list_price_cents integer, price_cents integer, status text, checkout_by timestamptz,
    order_id uuid, closed_at timestamptz, swap_id uuid, source text, created_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.declutter_items (id, title) VALUES ('${I(1)}', 'Oak chair'), ('${I(2)}', 'Lamp'), ('${I(3)}', 'Rug');
  INSERT INTO public.declutter_item_photos (item_id, storage_path, position) VALUES
    ('${I(1)}', '${SAM}/i1/b.jpg', 2), ('${I(1)}', '${SAM}/i1/a.jpg', 0), ('${I(1)}', '${SAM}/i1/c.jpg', 5),
    ('${I(2)}', '${SAM}/i2/x.jpg', 1);
  INSERT INTO public.declutter_orders VALUES ('${O1}', 'paid', 'pickup_home', 270, 4270, 0);
  INSERT INTO public.declutter_cart_items (item_id, item_title, seller_id, buyer_id, price_cents, status, checkout_by, order_id) VALUES
    ('${I(1)}', 'Oak chair', '${SAM}', '${ANN}', 4000, 'paid', now(), '${O1}'),
    ('${I(2)}', 'Lamp', '${SAM}', '${ANN}', 1000, 'in_cart', now() + interval '1 day', NULL),
    ('${I(3)}', 'Rug', '${SAM}', '${ANN}', 2000, 'in_cart', now() + interval '2 day', NULL),
    (NULL, 'Gone desk', '${SAM}', '${ANN}', 3000, 'expired', now() - interval '1 day', NULL);
  ${prev}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const cart = async (uid) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return (await db.query(`SELECT * FROM public.declutter_my_cart()`)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
};
const ann = await cart(ANN);
const by = (rows, title) => (Array.isArray(rows) ? rows.find((r) => r.item_title === title) : undefined);
check(Array.isArray(ann) && ann.length === 4 && "photo_path" in ann[0], `the buyer's read has photo_path on every line (${Array.isArray(ann) ? ann.length : ann.error})`);
check(by(ann, "Oak chair")?.photo_path === `${SAM}/i1/a.jpg`, `a paid line carries its item's FIRST photo -> ${by(ann, "Oak chair")?.photo_path}`);
check(by(ann, "Lamp")?.photo_path === `${SAM}/i2/x.jpg`, `each line its own item's photo -> ${by(ann, "Lamp")?.photo_path}`);
check(by(ann, "Rug") !== undefined && by(ann, "Rug").photo_path === null, `an item with no photo reads null -> ${by(ann, "Rug")?.photo_path}`);
check(by(ann, "Gone desk") !== undefined && by(ann, "Gone desk").photo_path === null, "a line whose listing is gone reads null");
check(by(ann, "Oak chair")?.order_status === "paid" && by(ann, "Oak chair")?.my_side === "buyer" && by(ann, "Oak chair")?.total_cents === 4270, "the other columns are unchanged");
const sam = await cart(SAM);
check(Array.isArray(sam) && by(sam, "Oak chair")?.photo_path === `${SAM}/i1/a.jpg` && by(sam, "Oak chair")?.my_side === "seller", "the seller's read carries the same photo");
const eve = await cart(EVE);
check(Array.isArray(eve) && eve.length === 0, "someone on neither side gets no rows");
const grants = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_my_cart()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.declutter_my_cart()', 'EXECUTE') AS auth`)).rows[0];
check(grants.anon === false && grants.auth === true, `grants: anon no, authenticated yes -> ${JSON.stringify(grants)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
