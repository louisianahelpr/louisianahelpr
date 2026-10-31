#!/usr/bin/env node
/**
 * PGlite proof for 20261031180550_declutter_deliver_off_stops_live_listings (LEAD-DELIVER-OFF-ALL, owner 2026-10-31)
 * and 20261031183416_declutter_deliver_off_saves_the_default (lead review: the saved default changes in the same call).
 *
 *   node src/test/pglite/declutterDeliverOffStopsLiveListings.pglite.mjs                     # after: both, 3x each
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDeliverOffStopsLiveListings.pglite.mjs  # RED: 180550 only (#3892)
 *   NEW_MIGRATION=none node src/test/pglite/declutterDeliverOffStopsLiveListings.pglite.mjs  # RED: no such function
 *
 * World: declutter_items with the columns touched and its real ways guard (declutter_items_handovers_guard, the newest
 * CREATE, read from the migrations, as a BEFORE UPDATE trigger). Stubbed, and said so: require_feature (no-op),
 * is_caller_banned (false), declutter_assert_member (the GUC test.uid). Not read against prod.
 * [fix] checks FAIL with no function (none); [fix 183416] checks also FAIL with 180550 alone (skip); [keep] pass in all.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031180550_declutter_deliver_off_stops_live_listings.sql";
const NEXT = "20261031183416_declutter_deliver_off_saves_the_default.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
const SKIP = MODE === "none";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
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
const OTHER = "44444444-4444-4444-4444-444444444444";
const THIRD = "55555555-5555-5555-5555-555555555555";
const id = (n) => `c0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
const guard = newest("declutter_items_handovers_guard");
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, handovers text[], porch_ok boolean,
    updated_at timestamptz);
  CREATE TABLE public.declutter_seller_defaults (member_id uuid PRIMARY KEY, handovers text[] NOT NULL
    CHECK (cardinality(handovers) BETWEEN 1 AND 4), updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.declutter_seller_defaults (member_id, handovers) VALUES
    ('${SELLER}', ARRAY['meetup','seller_delivery']), ('${OTHER}', ARRAY['porch','seller_delivery']), ('${THIRD}', ARRAY['seller_delivery']);
  CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.uid')::uuid $$;
  ${guard.sql}
  CREATE TRIGGER declutter_items_handovers_guard BEFORE UPDATE ON public.declutter_items
    FOR EACH ROW EXECUTE FUNCTION public.declutter_items_handovers_guard();
  INSERT INTO public.declutter_items VALUES
    ('${id(1)}', '${SELLER}', 'live',   ARRAY['porch','seller_delivery'], true,  now()),
    ('${id(2)}', '${SELLER}', 'live',   ARRAY['seller_delivery'],         false, now()),
    ('${id(3)}', '${SELLER}', 'paused', ARRAY['porch','seller_delivery'], true,  now()),
    ('${id(4)}', '${OTHER}',  'live',   ARRAY['porch','seller_delivery'], true,  now()),
    ('${id(5)}', '${SELLER}', 'live',   ARRAY['meetup','porch'],          true,  now()),
    ('${id(6)}', '${SELLER}', 'sold',   ARRAY['seller_delivery'],         false, now());
`);
console.log(`guard: ${guard.file}`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG_DIR + NEXT, "utf8"));
console.log(SKIP ? "before: no declutter_stop_my_seller_delivery" : MODE === "skip" ? `skip: ${THIS} only, applied 3x` : `after: ${THIS} then ${NEXT}, each applied 3x`);

const ways = async (n) => (await db.query(`SELECT handovers FROM public.declutter_items WHERE id = '${id(n)}'`)).rows[0].handovers.join(",");

await db.exec(`SET test.uid = '${SELLER}'`);
let changed = null;
try {
  changed = (await db.query("SELECT public.declutter_stop_my_seller_delivery() AS n")).rows[0].n;
} catch (e) {
  console.log(`  (call failed: ${e.message})`);
}
check(changed === 2, `[fix] it changes the caller's 2 live listings that offered seller delivery (got ${changed})`);
check(await ways(1) === "porch", "[fix] a live porch + I'll deliver listing keeps only porch pickup");
check(await ways(2) === "delivery", "[fix] a live listing whose only way was I'll deliver gets Helpr delivery, so it can still be bought");
check(await ways(3) === "porch,seller_delivery", "[keep] a paused listing is not touched");
check(await ways(4) === "porch,seller_delivery", "[keep] another seller's listing is not touched");
check(await ways(5) === "meetup,porch", "[keep] a listing without seller delivery is not touched");
check(await ways(6) === "seller_delivery", "[keep] a sold listing is not touched");
const def = async (m) => (await db.query(`SELECT handovers FROM public.declutter_seller_defaults WHERE member_id = '${m}'`)).rows[0].handovers.join(",");
check(await def(SELLER) === "meetup", `[fix 183416] the same call takes I'll deliver off the caller's saved default (got ${await def(SELLER)})`);
check(await def(OTHER) === "porch,seller_delivery", "[keep] another member's saved default is not touched");
const flag = (await db.query("SELECT current_setting('declutter.editing_listing', true) AS f")).rows[0].f;
check(!flag, `[keep] the editing flag is cleared after (got ${JSON.stringify(flag)})`);

// The ways guard still refuses taking a way off a live listing any other way, with the flag as this function leaves it
// (''). The flag never set in a session (NULL) is 20261031182255's fix, proved in
// declutterHandoversGuardFailsClosed.pglite.mjs.
await db.exec("SELECT set_config('declutter.editing_listing', '', false)");
let refused = false;
try { await db.exec(`UPDATE public.declutter_items SET handovers = ARRAY['porch'] WHERE id = '${id(4)}'`); } catch { refused = true; }
check(refused, "[keep] the ways guard still refuses taking a way off a live listing directly");

if (!SKIP) {
  const again = (await db.query("SELECT public.declutter_stop_my_seller_delivery() AS n")).rows[0].n;
  check(again === 0, `[fix] a second call changes nothing (got ${again})`);
  await db.exec(`SET test.uid = '${THIRD}'`);
  await db.query("SELECT public.declutter_stop_my_seller_delivery()");
  check(await def(THIRD) === "porch", `[fix 183416] a default whose only way was I'll deliver becomes porch pickup, the column default (got ${await def(THIRD)})`);
  const acl = (await db.query("SELECT has_function_privilege('anon', 'public.declutter_stop_my_seller_delivery()', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public.declutter_stop_my_seller_delivery()', 'EXECUTE') AS u")).rows[0];
  check(acl.a === false && acl.u === true, "[fix] anon cannot run it; a signed-in member can");
}

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
