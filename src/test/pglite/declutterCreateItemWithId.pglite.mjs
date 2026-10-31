#!/usr/bin/env node
/**
 * PGlite proof for 20261031160546_declutter_create_item_with_id (LEAD-POST-SLOW (a), owner 2026-10-31: a new
 * listing's photos upload the moment they are added, so the app picks the item id at the first photo and Post makes
 * the item with that id).
 *
 *   node src/test/pglite/declutterCreateItemWithId.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCreateItemWithId.pglite.mjs # RED: the newest definition before it
 *
 * The baseline is declutter_create_item loaded verbatim from its newest repo CREATE (20261027170717). Stubs are
 * prod-shaped: require_feature (feature_disabled 42501), is_caller_banned, declutter_assert_member,
 * declutter_area_label_problem. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261031160546_declutter_create_item_with_id.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: the definition before the migration (expect FAILs)");

/** One CREATE FUNCTION statement out of a migration file, whatever its dollar-quote tag. */
function fnFrom(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start))[1];
  const bodyAt = sql.indexOf(tag, start) + tag.length;
  const end = sql.indexOf(tag, bodyAt) + tag.length;
  return sql.slice(start, end) + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const BANNED = "00000000-0000-4000-8000-0000000000a3";
const ID1 = "00000000-0000-4000-8000-000000000101";
const ID2 = "00000000-0000-4000-8000-000000000102";
const ID3 = "00000000-0000-4000-8000-000000000103";

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
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
  CREATE FUNCTION public.declutter_assert_member(p_selling boolean) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    RETURN auth.uid();
  END $$;
  CREATE FUNCTION public.declutter_area_label_problem(l text, a text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN l ~ '^[0-9]+ ' THEN 'address' END $$;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, sale_mode text NOT NULL DEFAULT 'offers',
    status text NOT NULL, title text, description text NOT NULL DEFAULT '', category text, condition_stars smallint,
    delivery_size text, price_cents int, current_price_cents int, area_label text, area_lat numeric, area_lng numeric);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, seller_id uuid, floor_price_cents int,
    pickup_address text, pickup_lat numeric, pickup_lng numeric);
  INSERT INTO public.profiles VALUES ('${SELLER}', NULL), ('${OTHER}', NULL), ('${BANNED}', 'banned');
`);
await db.exec(fnFrom("20261027170717_declutter_free_section.sql", "declutter_create_item"));
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function call(uid, sql, args = []) {
  await as(uid);
  try {
    return { ok: (await db.query(sql, args)).rows[0] };
  } catch (e) {
    return { err: e.message };
  }
}
const ARGS = `'Lamp', 'A lamp', 'home', 4, 'small', 4000, 3000, 'Lafayette', '1 Main St', 30.2241, -92.0198`;
const withId = (id) => `SELECT public.declutter_create_item_with_id(${id === null ? "NULL" : `'${id}'`}, ${ARGS}) AS id`;

// 1. The chosen id is the new item's, for the caller, as a draft, with its private row.
const a = await call(SELLER, withId(ID1));
check("an item is made with the id the app chose", a.ok?.id === ID1, a.err ?? a.ok?.id);
const row = await one(`SELECT seller_id, status, price_cents, area_lat FROM public.declutter_items WHERE id = '${ID1}'`);
check("it is the caller's draft", row?.seller_id === SELLER && row?.status === "draft", JSON.stringify(row));
const pv = await one(`SELECT seller_id, floor_price_cents FROM public.declutter_item_private WHERE item_id = '${ID1}'`);
check("its private row holds the floor", pv?.seller_id === SELLER && pv?.floor_price_cents === 3000, JSON.stringify(pv));

// 2. An id already used is refused, by anyone, and never reaches the other listing.
const b = await call(OTHER, withId(ID1));
check("another member can't take a used id", /item_id_taken/.test(b.err ?? ""), b.err ?? JSON.stringify(b.ok));
const c = await call(SELLER, withId(ID1));
check("the same seller can't make it twice", /item_id_taken/.test(c.err ?? ""), c.err ?? JSON.stringify(c.ok));
const still = await one(`SELECT seller_id, (SELECT count(*)::int FROM public.declutter_items) AS n FROM public.declutter_items WHERE id = '${ID1}'`);
check("the first listing is untouched", still?.seller_id === SELLER && still?.n === 1, JSON.stringify(still));
const d = await call(SELLER, withId(null));
check("no id is refused", /item_id_taken/.test(d.err ?? ""), d.err ?? JSON.stringify(d.ok));

// 3. Every listing rule still applies.
const e = await call(SELLER, `SELECT public.declutter_create_item_with_id('${ID2}', 'Lamp', '', 'home', 4, 'small', 4000, 50, 'Lafayette', '1 Main St', 30.2, -92.0) AS id`);
check("a lowest price under $1 is refused", /invalid_floor_price/.test(e.err ?? ""), e.err ?? JSON.stringify(e.ok));
const f = await call(SELLER, `SELECT public.declutter_create_item_with_id('${ID2}', 'Lamp', '', 'home', 4, 'small', 4000, 3000, '12 Oak St', '1 Main St', 30.2, -92.0) AS id`);
check("a street address as the area is refused", /area_looks_like_address/.test(f.err ?? ""), f.err ?? JSON.stringify(f.ok));
const g = await call(BANNED, withId(ID2));
check("a banned member is refused", /account_restricted/.test(g.err ?? ""), g.err ?? JSON.stringify(g.ok));
const h = await call(null, withId(ID2));
check("signed out is refused", /not_authenticated/.test(h.err ?? ""), h.err ?? JSON.stringify(h.ok));
await db.exec(`INSERT INTO public.switch_off VALUES ('declutter')`);
const i = await call(SELLER, withId(ID2));
check("with the switch off it is refused", /feature_disabled/.test(i.err ?? ""), i.err ?? JSON.stringify(i.ok));
await db.exec(`DELETE FROM public.switch_off`);

// 4. The old call still makes a draft with a fresh id, through the same rules.
const j = await call(SELLER, `SELECT public.declutter_create_item(${ARGS}) AS id`);
check("declutter_create_item still makes a draft", !!j.ok?.id && j.ok.id !== ID1, j.err ?? j.ok?.id);
const k = await call(BANNED, `SELECT public.declutter_create_item(${ARGS}) AS id`);
check("declutter_create_item still refuses a banned member", /account_restricted/.test(k.err ?? ""), k.err ?? JSON.stringify(k.ok));
const pvOld = j.ok?.id ? await one(`SELECT floor_price_cents FROM public.declutter_item_private WHERE item_id = $1`, [j.ok.id]) : null;
check("declutter_create_item still writes the private row", pvOld?.floor_price_cents === 3000, JSON.stringify(pvOld));

// 5. Grants: anon and PUBLIC can't run it.
const acl = await one(`SELECT has_function_privilege('anon', 'public.declutter_create_item_with_id(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.declutter_create_item_with_id(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric)', 'EXECUTE') AS auth`).catch((err) => ({ err: err.message }));
check("anon can't run it; signed-in members can", acl?.anon === false && acl?.auth === true, JSON.stringify(acl));
void ID3;

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
