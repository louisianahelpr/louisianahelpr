#!/usr/bin/env node
/**
 * PGlite proof for 20261031182255_declutter_handovers_guard_fails_closed (lead review, 2026-10-31).
 *
 *   node src/test/pglite/declutterHandoversGuardFailsClosed.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoversGuardFailsClosed.pglite.mjs  # RED: the guards on main
 *
 * World: declutter_items with the columns the two guards read, and both real guards (declutter_items_handovers_guard
 * and declutter_items_porch_frozen, the NEWEST CREATE read from the migrations, any dollar-quote tag) as BEFORE UPDATE
 * triggers. Each refusal check runs in a FRESH PGlite session in which declutter.editing_listing was never set, through
 * a SECURITY DEFINER function, as the only code that can reach the table would. Not read against prod.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031182255_declutter_handovers_guard_fails_closed.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before) {
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

const id = (n) => `d0000000-0000-0000-0000-00000000000${n}`;
// Skip: the guards as main has them (newest before this file). After: newest overall, this file applied 3x on top.
const before = SKIP ? THIS : "99999999999999";
const guard = newest("declutter_items_handovers_guard", before);
const porch = newest("declutter_items_porch_frozen", before);
console.log(`guards: ${guard.file}, ${porch.file}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
if (!SKIP && guard.file !== THIS) throw new Error(`expected ${THIS} to hold the newest guard, got ${guard.file}`);

/** A fresh session: a new database, its world, and the flag never set. */
async function freshSession() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, status text, handovers text[], porch_ok boolean);
    ${guard.sql}
    ${porch.sql}
    CREATE TRIGGER declutter_items_handovers_guard BEFORE UPDATE ON public.declutter_items
      FOR EACH ROW EXECUTE FUNCTION public.declutter_items_handovers_guard();
    CREATE TRIGGER trg_declutter_items_porch_frozen BEFORE UPDATE ON public.declutter_items
      FOR EACH ROW EXECUTE FUNCTION public.declutter_items_porch_frozen();
    -- Stands for any SECURITY DEFINER code that updates a listing without setting the edit flag.
    CREATE FUNCTION public.definer_set_ways(p uuid, w text[], porch boolean) RETURNS void
      LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.declutter_items SET handovers = w, porch_ok = porch WHERE id = p $$;
    CREATE FUNCTION public.definer_set_porch(p uuid, porch boolean) RETURNS void
      LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.declutter_items SET porch_ok = porch WHERE id = p $$;
    INSERT INTO public.declutter_items VALUES
      ('${id(1)}', 'live',  ARRAY['porch','seller_delivery'], true),
      ('${id(2)}', 'live',  ARRAY['meetup','porch'],          true),
      ('${id(3)}', 'draft', ARRAY['porch','seller_delivery'], true),
      ('${id(4)}', 'live',  ARRAY['meetup'],                  false);
  `);
  if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));
  return db;
}
const ways = async (db, n) => (await db.query(`SELECT handovers, porch_ok FROM public.declutter_items WHERE id = '${id(n)}'`)).rows[0];
async function refused(db, sql) {
  try { await db.exec(sql); return false; } catch (e) { return /item_not_editable/.test(e.message); }
}

{
  const db = await freshSession();
  const flag = (await db.query("SELECT current_setting('declutter.editing_listing', true) AS f")).rows[0].f;
  check(flag === null, `[keep] the flag was never set in this session (current_setting is ${JSON.stringify(flag)})`);
  check(await refused(db, `SELECT public.definer_set_ways('${id(1)}', ARRAY['porch'], true)`),
    "[fix] a definer UPDATE that takes a way off a live listing is refused when the flag was never set");
  check((await ways(db, 1)).handovers.join(",") === "porch,seller_delivery", "[fix] and the listing keeps both its ways");
}
{
  const db = await freshSession();
  // porch_ok alone, so declutter_items_porch_frozen is the guard that must refuse it.
  check(await refused(db, `SELECT public.definer_set_porch('${id(2)}', false)`),
    "[fix] a definer UPDATE that turns porch off on a live listing is refused when the flag was never set");
}
{
  const db = await freshSession();
  await db.exec(`SELECT public.definer_set_ways('${id(4)}', ARRAY['meetup','porch'], true)`);
  check((await ways(db, 4)).handovers.join(",") === "meetup,porch", "[keep] adding a way (and porch on) to a live listing is still allowed");
  await db.exec(`SELECT public.definer_set_ways('${id(3)}', ARRAY['porch'], true)`);
  check((await ways(db, 3)).handovers.join(",") === "porch", "[keep] a draft's ways can still be taken away");
}
{
  const db = await freshSession();
  await db.exec(`BEGIN; SELECT set_config('declutter.editing_listing', '${id(1)}', true);
    SELECT public.definer_set_ways('${id(1)}', ARRAY['porch'], true); COMMIT;`);
  check((await ways(db, 1)).handovers.join(",") === "porch", "[keep] with the flag naming the item (declutter_edit_listing), a way can come off");
  check(await refused(db, `SELECT public.definer_set_ways('${id(2)}', ARRAY['meetup'], false)`),
    "[keep] after that transaction (flag back to '') another live listing is still refused");
}

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
