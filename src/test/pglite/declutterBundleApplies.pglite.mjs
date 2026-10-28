#!/usr/bin/env node
/**
 * PGlite proof for 20261028214524_declutter_bundle_applies.sql (deep audit 2026-10-28, #36): declutter_bundle_applies(ids) returns exactly the
 * live items whose "Buy 2+, get N% off" checkout can actually apply, and nothing else.
 *
 *   node src/test/pglite/declutterBundleApplies.pglite.mjs                  # applied 3x, then checked
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBundleApplies.pglite.mjs # RED: the function does not exist
 *   MUTANT=<name> node src/test/pglite/declutterBundleApplies.pglite.mjs    # a planted defect: must FAIL
 *
 * World: declutter_items, declutter_item_private, declutter_cart_items and declutter_bundle_rules with the columns
 * these read (as on prod), and prod's declutter_bundle_targets (20261027211754, the one discount computation
 * checkout uses). The cross-check: for every fixture item, at 5% and at 50%, the real declutter_bundle_targets
 * lowers its price in a 2-item cart exactly when declutter_bundle_applies returns it. Stubbed, and said so:
 * feature_enabled_for (a table of who has the switch), seed_hidden_for (a table), auth.uid.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261028214524_declutter_bundle_applies.sql";
const BUNDLE = "20261027211754_declutter_bundle_discount.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The floor ignored: every live paid item "applies".
  nofloor: ["AND i.current_price_cents > GREATEST(100, COALESCE(p.floor_price_cents, 100))", "AND i.current_price_cents > 100"],
  // At the floor counted as applying.
  atfloor: ["AND i.current_price_cents > GREATEST(100, COALESCE(p.floor_price_cents, 100))", "AND i.current_price_cents >= GREATEST(100, COALESCE(p.floor_price_cents, 100))"],
  // Any status.
  anystatus: ["       AND i.status = 'live'\n", ""],
  // No sign-in check.
  noauth: ["  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n", ""],
  // No switch.
  noswitch: ["  PERFORM public.require_feature('declutter');\n", ""],
  // Test listings shown to everyone.
  seed: ["       AND NOT (i.is_seed AND public.seed_hidden_for(v_uid))\n", ""],
  // anon left able to call it.
  anon: ["REVOKE ALL ON FUNCTION public.declutter_bundle_applies(uuid[]) FROM PUBLIC, anon;", "REVOKE ALL ON FUNCTION public.declutter_bundle_applies(uuid[]) FROM PUBLIC;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}
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
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), MEMBER = U(2), OFF = U(3), TESTER = U(4);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.switch_on (user_id uuid primary key);
  create function public.feature_enabled_for(p_key text) returns boolean language sql stable as
    $f$ select p_key = 'declutter' and exists (select 1 from public.switch_on s where s.user_id = auth.uid()) $f$;
  create function public.require_feature(p_key text) returns void language plpgsql stable as $f$
  begin
    if not public.feature_enabled_for(p_key) then raise exception 'feature_disabled' using errcode = '42501'; end if;
  end $f$;
  create table public.seed_hidden (user_id uuid primary key);
  create function public.seed_hidden_for(p_user uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.seed_hidden h where h.user_id = p_user) $f$;
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null, title text,
    price_cents integer not null, current_price_cents integer not null, is_seed boolean not null default false);
  create table public.declutter_item_private (item_id uuid primary key, floor_price_cents integer);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    price_cents integer, list_price_cents integer, status text default 'in_cart');
  create table public.declutter_bundle_rules (seller_id uuid primary key, percent smallint not null);
  grant select on all tables in schema public to authenticated;
`);
await db.exec(newestBefore("declutter_bundle_targets", THIS));
await db.exec(`insert into public.switch_on values ('${MEMBER}'), ('${TESTER}'), ('${SELLER}'); insert into public.seed_hidden values ('${MEMBER}');`);

// [n, status, current price, floor (null = none), is_seed]
const FIX = [
  [1, "live", 5000, 3000, false],   // above its floor: applies
  [2, "live", 3000, 3000, false],   // at its floor: cannot
  [3, "live", 5000, null, false],   // no floor: the $1 bound
  [4, "live", 100, null, false],    // $1, no floor: cannot
  [5, "live", 101, null, false],    // one cent above $1: applies (the discount reaches $1)
  [6, "live", 0, null, false],      // free: never
  [7, "reserved", 5000, 1000, false], // not live
  [8, "sold", 5000, 1000, false],     // not live
  [9, "live", 4000, 3999, false],   // a cent above its floor: applies
  [10, "live", 5000, 1000, true],   // a test listing
];
for (const [n, status, price, floor, seed] of FIX) {
  await db.query(`insert into public.declutter_items values ($1, $2, $3, 'Item', $4, $4, $5)`, [I(n), SELLER, status, price, seed]);
  if (floor !== null) await db.query(`insert into public.declutter_item_private values ($1, $2)`, [I(n), floor]);
}
const ids = `ARRAY[${FIX.map(([n]) => `'${I(n)}'`).join(", ")}, '${I(99)}']::uuid[]`;
async function as(uid, sql) {
  try {
    await db.exec(uid ? `set request.jwt.claim.sub = '${uid}'; set role authenticated;` : `set role anon;`);
    return { rows: (await db.query(sql)).rows };
  } catch (e) { return { error: String(e.message ?? e) }; }
  finally { await db.exec(`reset role; reset request.jwt.claim.sub;`); }
}
const applies = async (uid) => {
  const r = await as(uid, `select public.declutter_bundle_applies(${ids}) a`);
  return r.error ? r : (r.rows[0].a ?? []).slice().sort();
};

for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
if (skip) console.log("NEW_MIGRATION=skip: the function does not exist (expect FAILs)");

const want = [1, 3, 5, 9].map(I).sort();
const member = await applies(MEMBER);
check(JSON.stringify(member) === JSON.stringify(want), `[member] above the floor and $1, live, not a hidden test listing: ${JSON.stringify(member)}`);
const tester = await applies(TESTER);
check(JSON.stringify(tester) === JSON.stringify([...want, I(10)].sort()), `[tester] a test listing shows to whom it is not hidden: ${JSON.stringify(tester)}`);
const off = await applies(OFF);
check(off.error?.includes("feature_disabled"), `[switch] Declutter off for the caller: refused (${off.error ?? JSON.stringify(off)})`);
const signedOut = await as(null, `select public.declutter_bundle_applies(${ids}) a`);
check(!!signedOut.error, `[anon] signed out: refused (${signedOut.error ?? "answered"})`);
const r = await db.query(`select p is not null e, p is not null and has_function_privilege('anon', p, 'execute') a,
  p is not null and has_function_privilege('authenticated', p, 'execute') b from (select to_regprocedure('public.declutter_bundle_applies(uuid[])')::oid p) x`);
check(r.rows[0].e && !r.rows[0].a && r.rows[0].b, "[grants] anon cannot call it; signed-in members can");
await db.exec(`set role authenticated;`);
let noUid;
try { await db.query(`select public.declutter_bundle_applies(${ids})`); noUid = "answered"; } catch (e) { noUid = String(e.message); }
await db.exec(`reset role;`);
check(noUid.includes("not_authenticated"), `[auth] a signed-in role with no user: not_authenticated (${noUid})`);
const empty = await as(MEMBER, `select public.declutter_bundle_applies('{}'::uuid[]) a`);
check(Array.isArray(empty.rows) && JSON.stringify(empty.rows[0].a) === "[]", `[empty] no ids: an empty answer`);
const many = await as(MEMBER, `select public.declutter_bundle_applies(array(select gen_random_uuid() from generate_series(1, 201))) a`);
check(many.error?.includes("invalid_request"), `[limit] 201 ids: refused (${many.error ?? "answered"})`);
const shape = await as(MEMBER, `select pg_typeof(public.declutter_bundle_applies(${ids}))::text t`);
check(shape.rows?.[0]?.t === "uuid[]", `[shape] ids only (${shape.rows?.[0]?.t})`);

// The cross-check with checkout's own computation: in a 2-item cart (the item + a $50 companion), the real
// declutter_bundle_targets lowers the item's price exactly when declutter_bundle_applies returns it, at 5% and 50%.
await db.query(`insert into public.declutter_items values ($1, $2, 'live', 'Companion', 5000, 5000, false)`, [I(50), SELLER]);
for (const pct of [5, 50]) {
  await db.exec(`delete from public.declutter_bundle_rules; insert into public.declutter_bundle_rules values ('${SELLER}', ${pct});`);
  const disagree = [];
  for (const [n, status, price] of FIX) {
    if (status !== "live" || n === 10) continue;
    await db.exec(`delete from public.declutter_cart_items;`);
    const a = (await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents) values ($1, $2, $3, $4) returning id`, [I(n), MEMBER, SELLER, price])).rows[0].id;
    const b = (await db.query(`insert into public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents) values ($1, $2, $3, 5000) returning id`, [I(50), MEMBER, SELLER])).rows[0].id;
    const t = (await db.query(`select target_cents < base_cents d from public.declutter_bundle_targets($1, array[$2, $3]::uuid[]) where line_id = $2`, [SELLER, a, b])).rows[0].d;
    if (t !== (Array.isArray(member) && member.includes(I(n)))) disagree.push(n);
  }
  check(disagree.length === 0, `[checkout] at ${pct}%, declutter_bundle_targets discounts exactly the returned items (disagree: ${JSON.stringify(disagree)})`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
