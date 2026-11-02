#!/usr/bin/env node
/**
 * PGlite proof for 20261102015451_declutter_i_reviewed.sql (A3-76, audit 11-01): a member reads whether THEIR side of
 * an order has left its review, so "Leave a review" stays gone on a second device. Never the other side's (blind
 * rule), FALSE for an order the caller is not on, signed-out refused, anon cannot execute.
 *
 *   node src/test/pglite/declutterIReviewed.pglite.mjs                      # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterIReviewed.pglite.mjs   # red: the checks need it
 *   PLANT=any_side node src/test/pglite/declutterIReviewed.pglite.mjs       # red: a read that tells the other side's review
 *   PLANT=anon node src/test/pglite/declutterIReviewed.pglite.mjs           # red: anon keeps execute
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const file = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_i_reviewed.sql"));
let mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${file}`, "utf8");
if (process.env.PLANT === "any_side") mig = mig.replace("AND r.reviewer_side = v_side", "");
if (process.env.PLANT === "anon") mig = mig.replace("FROM PUBLIC, anon;", "FROM PUBLIC;");
const slice4 = readFileSync(`${MIG_DIR}20261015042253_declutter_slice4_handover_payout.sql`, "utf8");
const orderSide = slice4.match(/CREATE OR REPLACE FUNCTION public\.declutter_order_side\([\s\S]*?\$fn\$;/)[0];
const db = new PGlite();
const B = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333";
const O = "a0000000-0000-4000-8000-000000000001";
await db.exec(`
create role anon; create role authenticated; create role service_role;
-- Supabase gives anon an EXPLICIT execute on new functions; REVOKE FROM PUBLIC alone leaves it (CLAUDE.md).
alter default privileges grant execute on functions to anon, authenticated;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table declutter_orders(id uuid primary key, buyer_id uuid, seller_id uuid, status text default 'handed_over');
create table declutter_reviews(id uuid primary key default gen_random_uuid(), order_id uuid, reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars int, unique (order_id, reviewer_side));
insert into declutter_orders values ('${O}', '${B}', '${S}');
`);
await db.exec(orderSide);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 1; i <= 3; i++) await db.exec(mig);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };
const reviewed = async (uid, o = O) => (await as(uid, `select public.declutter_i_reviewed('${o}') v`)).rows[0].v;

await safe("noneYetForEitherSide", async () => (await reviewed(B)) === false && (await reviewed(S)) === false);
await db.exec(`insert into declutter_reviews(order_id, reviewer_id, reviewee_id, reviewer_side, stars) values ('${O}', '${B}', '${S}', 'buyer', 5)`);
await safe("buyerSeesTheirOwn", async () => (await reviewed(B)) === true);
await safe("sellerIsNotToldTheBuyersReview", async () => (await reviewed(S)) === false);
await safe("strangerGetsFalse", async () => (await reviewed(X)) === false);
await safe("unknownOrderFalse", async () => (await reviewed(B, "a0000000-0000-4000-8000-000000000009")) === false);
await safe("nullOrderFalse", async () => (await as(B, `select public.declutter_i_reviewed(null) v`)).rows[0].v === false);
await safe("signedOutRefused", async () => { try { await reviewed(null); return "no error"; } catch (e) { return /not_authenticated/.test(e.message) || e.message; } });
await safe("grants", async () => {
  const r = (await db.query(`select has_function_privilege('anon', 'public.declutter_i_reviewed(uuid)', 'execute') a, has_function_privilege('authenticated', 'public.declutter_i_reviewed(uuid)', 'execute') u`)).rows[0];
  return r.a === false && r.u === true;
});

const red = Object.entries(results).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(results, null, 1));
console.log(red.length ? `RED ${red.length} of ${Object.keys(results).length}` : `ALL OK ${Object.keys(results).length}`);
process.exit(red.length ? 1 : 0);
