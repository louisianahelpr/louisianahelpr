#!/usr/bin/env node
/**
 * PGlite proof for 20261030152601_helpr_route_same_seller_visit (audit 1c D3-2).
 *
 *   node src/test/pglite/helprRouteSameSellerVisit.pglite.mjs                # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/helprRouteSameSellerVisit.pglite.mjs   # before: must FAIL
 *   MUTANT=<name> node src/test/pglite/helprRouteSameSellerVisit.pglite.mjs  # a planted defect: must FAIL
 *
 * World: the REAL helpr_task_distance_m + helpr_route_leg_miles (newest definitions), the migration verbatim, and
 * helpr_tasks / declutter_orders with the columns the functions read. Stubbed, and said so: auth.uid() and who may
 * deliver (helpr_task_assert_helpr: the test's current user), the feature switch, vehicle fit, blocks, Stripe mode, the
 * hold (a table of held orders), the seller's times (a table of refused times), and for helpr_my_route
 * helpr_task_dropoff_shows_at (always shown) and helpr_task_items (none).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261030152601_helpr_route_same_seller_visit.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

// Planted defects (each must turn a check red).
const MUTANTS = {
  // A pickup whose Picked up is not open yet joins the visit anyway.
  window: ["AND (v_s->>'slot' IS NULL OR (v_s->>'slot')::timestamptz - interval '30 minutes' <= v_visit) THEN", "THEN"],
  // Any pickup from this seller joins, wherever it is.
  point: ["           AND public.helpr_task_distance_m(v_lat, v_lng, (v_s->>'lat')::numeric, (v_s->>'lng')::numeric) <= 50\n", ""],
  // Only the exact same point joins (the accept card's 50 m would offer a time that still shows two stops).
  exact: ["(v_s->>'lat')::numeric, (v_s->>'lng')::numeric) <= 50\n", "(v_s->>'lat')::numeric, (v_s->>'lng')::numeric) = 0\n"],
  // The neighbour's pickup joins.
  neighbour: ["           AND v_s->>'seller' = v_seller\n", ""],
  // helpr_my_route does not tell the plan the seller, so nothing ever joins.
  passes: ["        'seller', t.pickup_contact_id));", "        'nobody', t.pickup_contact_id));"],
  // A handover to whoever had it before counts for this Helpr.
  handed: ["WHEN p->>'kind' = 'pickup' AND t.handed_over_to = v_uid THEN t.handed_over_at END", "WHEN p->>'kind' = 'pickup' THEN t.handed_over_at END"],
  // A drop-off counts as the visit a pickup can join.
  kind: ["v_at_pickup := v_best->>'kind' = 'pickup';", "v_at_pickup := true;"],
  // A joined stop costs another stop.
  seq: ["'kind', v_s->>'kind', 'seq', v_seq,", "'kind', v_s->>'kind', 'seq', v_seq + 1,"],
  // Another seller's pickup time is offered.
  seller: ["     AND x.pickup_contact_id = t.pickup_contact_id\n", ""],
  // The same seller's other place counts as here.
  place: ["     AND public.helpr_task_distance_m(x.pickup_lat, x.pickup_lng, t.pickup_lat, t.pickup_lng) <= 50\n", ""],
  // Another Helpr's pickup time is offered.
  owner: ["WHERE x.helpr_id = v_uid AND x.status = 'accepted' AND x.id <> t.id", "WHERE x.status = 'accepted' AND x.id <> t.id"],
  // A pickup time the seller's times refuse is offered.
  slot: ["     AND public.helpr_task_source_slot_ok(t.source_kind, t.source_id, x.pickup_slot_start);", "     ;"],
  // A pickup held by a problem is offered.
  held: ["     AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)\n", ""],
  // A delivery the caller could not take answers.
  candidate: ["     AND x.status = 'open' AND x.open_until > now()\n", ""],
  // Anyone may call it.
  grant: ["REVOKE ALL ON FUNCTION public.helpr_task_same_pickup_slot(uuid) FROM PUBLIC, anon;", ""],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

let sql = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  if (!sql.includes(MUTANTS[MUTANT][0])) throw new Error(`mutant ${MUTANT}: anchor gone`);
  sql = sql.replace(MUTANTS[MUTANT][0], MUTANTS[MUTANT][1]);
}

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.helpr_tasks (
    id uuid PRIMARY KEY, source_kind text NOT NULL DEFAULT 'declutter_delivery', source_id uuid, status text NOT NULL,
    size text NOT NULL DEFAULT 'small', pickup_lat numeric, pickup_lng numeric, customer_id uuid, pickup_contact_id uuid,
    helpr_id uuid, open_until timestamptz, latest_pickup_at timestamptz, pickup_slot_start timestamptz,
    title text DEFAULT 'Item', pickup_area text, dropoff_area text, pickup_address text DEFAULT 'A St', dropoff_address text DEFAULT 'B St',
    dropoff_lat numeric DEFAULT 30.46, dropoff_lng numeric DEFAULT -91.18, handed_over_at timestamptz, handed_over_to uuid);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, paid_at timestamptz);
  CREATE TABLE public.test_held (order_id uuid PRIMARY KEY);
  CREATE TABLE public.test_refused_slots (at timestamptz PRIMARY KEY);
  CREATE TABLE public.test_me (id uuid);
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT id FROM public.test_me $f$;
  CREATE FUNCTION public.helpr_task_dropoff_shows_at(uuid, text, timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $f$ SELECT '-infinity'::timestamptz $f$;
  CREATE FUNCTION public.helpr_task_items(text, uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '[]'::jsonb $f$;
  CREATE FUNCTION public.helpr_task_source_require_feature(text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
  CREATE FUNCTION public.helpr_task_assert_helpr() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT id FROM public.test_me $f$;
  CREATE FUNCTION public.helpr_task_vehicle_fits(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  CREATE FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE FUNCTION public.helpr_task_source_held(text, uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.test_held h WHERE h.order_id = $2) $f$;
  CREATE FUNCTION public.helpr_task_source_slot_ok(text, uuid, timestamptz) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT NOT EXISTS (SELECT 1 FROM public.test_refused_slots r WHERE r.at = $3) $f$;
`);
await db.exec(newest("helpr_task_distance_m"));
await db.exec(newest("helpr_route_leg_miles"));
await db.exec(newest("helpr_route_plan")); // The plan before this migration: what NEW_MIGRATION=skip tests.
await db.exec(newest("helpr_my_route"));
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(sql);

let failed = 0;
let passed = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed++; else failed++;
}

const NOW = "2026-11-02T13:00:00Z";
const AT = (hhmm) => `2026-11-02T${hhmm}:00Z`;
const SELLER = { lat: 30.45, lng: -91.18 };
const NEAR = { lat: 30.46, lng: -91.18 }; // A drop-off close by, so the old plan stops there between two pickups.
const pick = (k, slot, p = SELLER, seller = "s1") => ({ key: `p${k}`, task: k, kind: "pickup", ...p, slot, ...(seller ? { seller } : {}) });
const drop = (k, p = NEAR) => ({ key: `d${k}`, task: k, kind: "dropoff", ...p, slot: null });
async function plan(stops, from = SELLER) {
  const r = await db.query(`SELECT public.helpr_route_plan($1::jsonb, $2, $3, $4::timestamptz) AS p`, [JSON.stringify(stops), from?.lat ?? null, from?.lng ?? null, NOW]);
  return r.rows[0].p;
}
const seqs = (p) => p.stops.map((s) => `${s.key}:${s.seq}`).join(" ");

// The audit's repro: two pickups at one seller, 30 minutes apart, a drop-off nearby.
const repro = await plan([pick("a", AT("14:00")), drop("a"), pick("b", AT("14:30")), drop("b")]);
check(repro.stops.map((s) => s.key).slice(0, 2).join() === "pa,pb", `[visit] the two pickups are one after the other, no drop-off between (${seqs(repro)})`);
check(repro.stops[0].seq === repro.stops[1].seq, "[visit] they are one visit (one seq)");
check(repro.stops[1].leg_miles === 0, "[visit] the joined pickup has no leg");
check(repro.stops[1].late === false, "[visit] and is not late");
const seen = new Set(repro.stops.map((s) => s.seq));
check(seen.size === 3, `[visit] 3 visits for 4 stops (${seen.size})`);
const oneTwo = await plan([pick("a", AT("14:00")), drop("a")]);
check(repro.drive_minutes - oneTwo.drive_minutes <= 5, `[visit] the joined pickup adds no stop time, only the second drop-off's (${repro.drive_minutes} vs ${oneTwo.drive_minutes})`);

const sameTime = await plan([pick("a", AT("14:00")), pick("b", AT("14:00")), drop("a"), drop("b")]);
check(sameTime.stops[0].seq === sameTime.stops[1].seq && sameTime.stops[1].kind === "pickup", `[visit] the same booked time joins too (${seqs(sameTime)})`);

// Over 30 minutes apart: Picked up would be refused at the first visit (helpr_task_picked_up), so two visits stay.
const later = await plan([pick("a", AT("14:00")), drop("a"), pick("b", AT("16:00")), drop("b")]);
const pa = later.stops.find((s) => s.key === "pa");
const pb = later.stops.find((s) => s.key === "pb");
check(pa.seq !== pb.seq, `[window] a pickup 2 hours later stays its own stop (${seqs(later)})`);
check(new Date(pb.arrive_at).getTime() === Date.parse(AT("16:00")), `[window] and keeps its booked time (${pb.arrive_at})`);

const another = { lat: 30.5, lng: -91.1 };
const elsewhere = await plan([pick("a", AT("14:00")), pick("b", AT("14:00"), another), drop("a"), drop("b")]);
check(new Set(elsewhere.stops.map((s) => s.seq)).size === 4, `[point] the same seller's other address never joins (${seqs(elsewhere)})`);

// The accept card's own rule: the same seller within 50 m. About 11 m per 0.0001 degree of latitude.
const m10 = { lat: 30.4501, lng: -91.18 };
const m70 = { lat: 30.4506, lng: -91.18 };
const near10 = await plan([pick("a", AT("14:00")), pick("b", AT("14:00"), m10), drop("a"), drop("b")]);
check(near10.stops[0].seq === near10.stops[1].seq && near10.stops[1].kind === "pickup", `[50m] the same seller 11 m away joins, as the accept card offers (${seqs(near10)})`);
const near70 = await plan([pick("a", AT("14:00")), pick("b", AT("14:00"), m70), drop("a"), drop("b")]);
check(near70.stops[0].seq !== near70.stops.find((s) => s.key === "pb").seq, `[50m] the same seller 67 m away stays its own stop (${seqs(near70)})`);
const neighbour = await plan([pick("a", AT("14:00")), pick("b", AT("14:00"), SELLER, "s2"), drop("a"), drop("b")]);
check(neighbour.stops[0].seq !== neighbour.stops.find((s) => s.key === "pb").seq, `[seller] another seller at the same point never joins (${seqs(neighbour)})`);
const anon = await plan([pick("a", AT("14:00"), SELLER, null), pick("b", AT("14:00"), SELLER, null), drop("a"), drop("b")]);
check(anon.stops[0].seq !== anon.stops.find((s) => s.key === "pb").seq, `[seller] stops with no seller (helpr_route_suggestions) never join: that plan is as it was (${seqs(anon)})`);

// A drop-off at the seller's point is no pickup visit: a pickup there starts its own.
const afterDrop = await plan([{ ...drop("z", SELLER), seller: "s1" }, pick("b", null)], another);
check(afterDrop.stops[0].seq !== afterDrop.stops[1].seq, `[kind] a drop-off is not a visit a pickup joins (${seqs(afterDrop)})`);

const noSlot = await plan([pick("a", AT("13:10")), pick("b", null), drop("a"), drop("b")], SELLER);
check(noSlot.stops.filter((s) => s.kind === "pickup").every((s, _, all) => s.seq === all[0].seq), `[visit] a pickup with no booked time joins (${seqs(noSlot)})`);

// Nothing lost: every stop once, each drop-off after its own pickup.
for (const p of [repro, later, sameTime, elsewhere]) {
  const keys = p.stops.map((s) => s.key);
  check(new Set(keys).size === keys.length && keys.indexOf("da") > keys.indexOf("pa") && keys.indexOf("db") > keys.indexOf("pb"), `[order] every stop once, each pickup first (${keys.join()})`);
}

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ME = U(1); const OTHER = U(2); const SELLER_A = U(3); const SELLER_B = U(4); const BUYER = U(5);

// helpr_my_route, end to end: the seller reaches the plan, and never the screen.
{
  await db.query(`INSERT INTO public.test_me VALUES ($1)`, [ME]);
  const R = (n) => `30000000-0000-0000-0000-00000000000${n}`;
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const add = (id, o) => db.query(
    `INSERT INTO public.helpr_tasks (id, status, pickup_lat, pickup_lng, customer_id, pickup_contact_id, helpr_id, pickup_slot_start, handed_over_at, handed_over_to)
     VALUES ($1, 'accepted', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, o.lat ?? SELLER.lat, o.lng ?? SELLER.lng, BUYER, o.seller ?? SELLER_A, ME, soon, o.handed ?? null, o.handedTo ?? null]);
  await add(R(1), { handed: new Date().toISOString(), handedTo: ME });
  await add(R(2), { lat: 30.4501, handed: new Date().toISOString(), handedTo: OTHER });
  await add(R(3), { seller: SELLER_B });
  const route = (await db.query(`SELECT public.helpr_my_route(NULL, NULL) AS r`)).rows[0].r;
  const stop = (id) => route.stops.find((s) => s.task_id === id && s.kind === "pickup");
  check(stop(R(1)).seq === stop(R(2)).seq, "[route] two deliveries from one seller, 11 m apart: one visit");
  check(stop(R(3)).seq !== stop(R(1)).seq, "[route] another seller at the same point: its own stop");
  check(route.stops.every((s) => !("seller" in s) && !("pickup_contact_id" in s)), "[route] no seller id reaches the Helpr's screen");
  check(!SKIP ? stop(R(1)).handed_over_at !== null && stop(R(1)).handed_over_at !== undefined : false, "[route] handed over to me: the stop says when");
  check(stop(R(2)).handed_over_at === null, "[route] handed over to someone else (before a reopen): not for me");
  check(!SKIP ? route.stops.filter((s) => s.kind === "dropoff").every((s) => s.handed_over_at === null) : false, "[route] a drop-off stop has none");
  await db.query(`DELETE FROM public.helpr_tasks`);
  await db.query(`DELETE FROM public.test_me`);
}

// helpr_task_same_pickup_slot.
if (!SKIP) {
  const task = async (id, o) => db.query(
    `INSERT INTO public.helpr_tasks (id, source_id, status, pickup_lat, pickup_lng, customer_id, pickup_contact_id, helpr_id, open_until, latest_pickup_at, pickup_slot_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '1 day', now() + interval '6 days', $9)`,
    [id, o.order ?? null, o.status, o.lat ?? SELLER.lat, o.lng ?? SELLER.lng, BUYER, o.seller ?? SELLER_A, o.helpr ?? null, o.slot ?? null]);
  const ask = async (id) => (await db.query(`SELECT public.helpr_task_same_pickup_slot($1) AS s`, [id])).rows[0].s;
  const O = (n) => `10000000-0000-0000-0000-00000000000${n}`;
  const T = (n) => `20000000-0000-0000-0000-00000000000${n}`;
  for (let n = 1; n <= 9; n++) await db.query(`INSERT INTO public.declutter_orders VALUES ($1, now())`, [O(n)]);
  await db.query(`INSERT INTO public.test_me VALUES ($1)`, [ME]);
  const slot = new Date(Date.now() + 2 * 86_400_000);
  const iso = slot.toISOString();
  await task(T(1), { status: "open", order: O(1) });
  check(await ask(T(1)) === null, "[slot] no pickup of mine at this seller: nothing");
  await task(T(2), { status: "accepted", order: O(2), helpr: ME, slot: iso });
  check((await ask(T(1)))?.getTime() === slot.getTime(), "[slot] my pickup at this seller and place: its time");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(2)]);
  await task(T(3), { status: "accepted", order: O(3), helpr: ME, slot: iso, seller: SELLER_B });
  check(await ask(T(1)) === null, "[slot] another seller at the same point: nothing");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(3)]);
  await task(T(4), { status: "accepted", order: O(4), helpr: ME, slot: iso, lat: 30.5, lng: -91.1 });
  check(await ask(T(1)) === null, "[slot] this seller's other place: nothing");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(4)]);
  await task(T(5), { status: "accepted", order: O(5), helpr: OTHER, slot: iso });
  check(await ask(T(1)) === null, "[slot] another Helpr's pickup: nothing");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(5)]);
  await task(T(6), { status: "accepted", order: O(6), helpr: ME, slot: new Date(Date.now() - 3_600_000).toISOString() });
  check(await ask(T(1)) === null, "[slot] a time already past: nothing");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(6)]);
  await task(T(7), { status: "accepted", order: O(7), helpr: ME, slot: new Date(Date.now() + 9 * 86_400_000).toISOString() });
  check(await ask(T(1)) === null, "[slot] a time past this delivery's deadline: nothing");
  await db.query(`DELETE FROM public.helpr_tasks WHERE id = $1`, [T(7)]);
  await task(T(8), { status: "accepted", order: O(8), helpr: ME, slot: iso });
  await db.query(`INSERT INTO public.test_refused_slots VALUES ($1)`, [iso]);
  check(await ask(T(1)) === null, "[slot] a time the seller's times refuse: nothing");
  await db.query(`DELETE FROM public.test_refused_slots`);
  await db.query(`INSERT INTO public.test_held VALUES ($1)`, [O(8)]);
  check(await ask(T(1)) === null, "[slot] my pickup held by a problem: nothing");
  await db.query(`DELETE FROM public.test_held`);
  check((await ask(T(1)))?.getTime() === slot.getTime(), "[slot] (control) the same pickup, nothing refusing it, answers");
  const refused = async (id) => { try { await ask(id); return false; } catch (e) { return e.message === "task_not_found"; } };
  check(await refused(T(8)), "[slot] a delivery not open: task_not_found");
  check(await refused(U(9)), "[slot] no such delivery: task_not_found");
  const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'helpr_task_same_pickup_slot'`)).rows[0].a ?? "";
  check(!/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl) && /authenticated=X/.test(acl), `[slot] members only, not anon or public (${acl})`);
} else {
  check(false, "[slot] helpr_task_same_pickup_slot does not exist before this migration");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
