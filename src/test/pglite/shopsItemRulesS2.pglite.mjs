#!/usr/bin/env node
/**
 * PGlite proof for 20261112222000_shops_item_rules_s2.sql (Shops audit 2, 11-12):
 *   S2-002: a live photo change by an owner inside the 30-day hold after a rejection waits for an admin on a CLEAN
 *           check too (and is told why); outside the hold a clean check keeps it live; a flag still holds it.
 *   S2-003: a download has one price: no active option row on a download, no item becomes a download (or a download
 *           gets option lists) while it has options; an existing download with options keeps its price and drops them.
 *
 *   node src/test/pglite/shopsItemRulesS2.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsItemRulesS2.pglite.mjs # RED: the old bodies, no triggers
 *   MIGRATION_PATH=<planted copy> node ...                              # RED on a planted defect
 *
 * Real: shop_items_variant_rollup and shop_item_variants_touch_item (20261106165310). Stubbed, and said so: the
 * tables cut to the columns read; admin_audit_log; declutter_notify writes a notices table.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112222000_shops_item_rules_s2.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a2f-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const HELD = U(1), FREE = U(2), OLDREJ = U(3), SHOP = U(10);
const L_HELD = U(20), L_FREE = U(21), L_OLD = U(22), L_FLAG = U(23), DL_OPTS = U(30), MADE_OPTS = U(31), DL_PLAIN = U(32);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, status text, kind text DEFAULT 'made', subtype text DEFAULT 'art',
  title text, description text DEFAULT 'd', admin_approved_at timestamptz, submitted_at timestamptz, live_at timestamptz, updated_at timestamptz,
  price_cents integer, stock_count integer, option_names text[] NOT NULL DEFAULT '{}'::text[]);
CREATE TABLE public.shop_item_variants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES public.shop_items(id),
  option_values text[] NOT NULL, price_cents integer NOT NULL, stock_count integer, active boolean NOT NULL DEFAULT true,
  position smallint NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE public.shop_item_private (item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text, updated_at timestamptz);
CREATE TABLE public.shop_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, position smallint);
CREATE TABLE public.admin_audit_log (action text, details jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notices VALUES (u, t, ti, m, l) $$;
INSERT INTO public.admin_audit_log (action, details, created_at) VALUES
  ('shop_item_rejected', '{"owner_id":"${HELD}"}', now() - interval '3 days'),
  ('shop_item_rejected', '{"owner_id":"${OLDREJ}"}', now() - interval '40 days'),
  ('shop_item_approved', '{"owner_id":"${FREE}"}', now() - interval '1 day');
INSERT INTO public.shop_items (id, shop_id, owner_id, status, kind, title, live_at, price_cents) VALUES
  ('${L_HELD}', '${SHOP}', '${HELD}', 'live', 'made', 'Cypress bowl', now(), 2000),
  ('${L_FREE}', '${SHOP}', '${FREE}', 'live', 'made', 'Oak spoon', now(), 2000),
  ('${L_OLD}', '${SHOP}', '${OLDREJ}', 'live', 'made', 'Pine box', now(), 2000),
  ('${L_FLAG}', '${SHOP}', '${FREE}', 'live', 'made', 'Ash cup', now(), 2000),
  ('${DL_OPTS}', '${SHOP}', '${FREE}', 'draft', 'digital', 'Quilt pattern', NULL, 900),
  ('${MADE_OPTS}', '${SHOP}', '${FREE}', 'draft', 'made', 'Soy candle', NULL, 900),
  ('${DL_PLAIN}', '${SHOP}', '${FREE}', 'draft', 'digital', 'Coloring pages', NULL, 700);
INSERT INTO public.shop_item_private (item_id) SELECT id FROM public.shop_items;
INSERT INTO public.shop_item_photos (item_id, position) SELECT id, n FROM public.shop_items, generate_series(0, 2) n;
`);
await db.exec(fnFrom("20261106165310_shops_item_variants.sql", "shop_items_variant_rollup"));
await db.exec(fnFrom("20261106165310_shops_item_variants.sql", "shop_item_variants_touch_item"));
await db.exec(`
CREATE TRIGGER trg_shop_items_variant_rollup BEFORE UPDATE ON public.shop_items FOR EACH ROW EXECUTE FUNCTION public.shop_items_variant_rollup();
CREATE TRIGGER trg_shop_item_variants_touch_item AFTER INSERT OR UPDATE OR DELETE ON public.shop_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_variants_touch_item();
UPDATE public.shop_items SET option_names = '{Size}' WHERE id IN ('${DL_OPTS}', '${MADE_OPTS}');
INSERT INTO public.shop_item_variants (item_id, option_values, price_cents) VALUES
  ('${DL_OPTS}', '{Small}', 500), ('${DL_OPTS}', '{Large}', 2000), ('${MADE_OPTS}', '{Small}', 1200), ('${MADE_OPTS}', '{Large}', 1800);
`);
const price = async (id) => (await db.query(`SELECT price_cents, option_names FROM public.shop_items WHERE id = $1`, [id])).rows[0];
check((await price(DL_OPTS)).price_cents === 500, "setup: the rollup priced the download at its lowest option");

if (skip) {
  await db.exec(fnFrom("20261112204756_shops_live_item_photos.sql", "shops_record_item_ai_check"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const run = async (sql, params) => { try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { err: e.message }; } };

// ---- S2-003
let p = await price(DL_OPTS);
check(p.price_cents === 500 && p.option_names.length === 0, "an existing download with options keeps its price and drops its lists", JSON.stringify(p));
let v = (await db.query(`SELECT count(*)::int n FROM public.shop_item_variants WHERE item_id = $1 AND active`, [DL_OPTS])).rows[0].n;
check(v === 0, "its option rows are switched off (kept for any order line)", String(v));
let r = await run(`INSERT INTO public.shop_item_variants (item_id, option_values, price_cents) VALUES ($1, '{Huge}', 3000)`, [DL_PLAIN]);
check(/options_not_for_downloads/.test(r.err ?? ""), "a download takes no active option row", r.err ?? "inserted");
r = await run(`UPDATE public.shop_items SET option_names = '{Size}' WHERE id = $1`, [DL_PLAIN]);
check(/options_not_for_downloads/.test(r.err ?? ""), "a download takes no option list", r.err ?? "updated");
r = await run(`UPDATE public.shop_item_variants SET active = true WHERE item_id = $1`, [DL_OPTS]);
check(/options_not_for_downloads/.test(r.err ?? ""), "a switched-off option on a download cannot be switched back on", r.err ?? "updated");
r = await run(`UPDATE public.shop_items SET kind = 'digital' WHERE id = $1`, [MADE_OPTS]);
check(/options_not_for_downloads/.test(r.err ?? ""), "an item with options cannot become a download", r.err ?? "updated");
r = await run(`INSERT INTO public.shop_item_variants (item_id, option_values, price_cents) VALUES ($1, '{Medium}', 1500)`, [MADE_OPTS]);
check(!r.err, "a made item still takes options", r.err);
r = await run(`UPDATE public.shop_items SET title = 'Quilt pattern 2', price_cents = 800 WHERE id = $1`, [DL_PLAIN]);
check(!r.err, "a plain download still saves", r.err);
r = await run(`UPDATE public.shop_items SET option_names = '{}' WHERE id = $1`, [DL_OPTS]);
check(!r.err, "clearing a download's lists is allowed", r.err);

// ---- S2-002
const photos = async (id) => (await db.query(`SELECT id FROM public.shop_item_photos WHERE item_id = $1`, [id])).rows.map((x) => x.id);
const judge = async (id, owner, flag) => {
  const it = (await db.query(`SELECT * FROM public.shop_items WHERE id = $1`, [id])).rows[0];
  return run(`SELECT public.shops_record_item_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7, $8) AS at`,
    [id, owner, await photos(id), it.kind, it.subtype, it.title, it.description, flag]);
};
const st = async (id) => (await db.query(`SELECT status, live_at, submitted_at FROM public.shop_items WHERE id = $1`, [id])).rows[0];
const notes = async (u) => (await db.query(`SELECT * FROM public.notices WHERE user_id = $1`, [u])).rows;
r = await judge(L_HELD, HELD, null);
let s = await st(L_HELD);
check(!r.err && s.status === "pending_review" && s.live_at === null && s.submitted_at !== null,
  "inside the 30-day hold, a clean check on a live photo change waits for an admin", JSON.stringify(r) + JSON.stringify(s));
let n = await notes(HELD);
check(n.length === 1 && n[0].title === "Your item is waiting for a check" && n[0].message.includes('"Cypress bowl"') && n[0].message.includes("30 days") && n[0].link === "/shops/mine",
  "and the owner is told which item and why", JSON.stringify(n));
r = await judge(L_FREE, FREE, null);
check(!r.err && (await st(L_FREE)).status === "live", "with no rejection, a clean check keeps the item live", JSON.stringify(r));
check((await notes(FREE)).length === 0, "and tells nobody");
r = await judge(L_OLD, OLDREJ, null);
check(!r.err && (await st(L_OLD)).status === "live", "a rejection older than 30 days does not hold it", JSON.stringify(r));
r = await judge(L_FLAG, FREE, "shows a weapon");
check(!r.err && (await st(L_FLAG)).status === "pending_review", "a flag still holds a live item", JSON.stringify(r));
n = await notes(FREE);
check(n.length === 1 && n[0].type === "warning" && n[0].message.includes("shows a weapon"), "with the flag's own notice", JSON.stringify(n));
await db.exec(`SET ROLE authenticated;`);
r = await run(`SELECT public.shops_record_item_ai_check($1, $2, '{}'::uuid[], 'a', 'b', 'c', 'd', NULL)`, [L_FREE, FREE]);
await db.exec(`RESET ROLE;`);
check(/permission denied/.test(r.err ?? ""), "members still cannot record a verdict", JSON.stringify(r));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
