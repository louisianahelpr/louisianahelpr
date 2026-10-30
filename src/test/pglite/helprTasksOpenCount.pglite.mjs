#!/usr/bin/env node
/**
 * PGlite proof for 20261030044539_helpr_tasks_open_count (audit 1c D3-6, builder 75): how many deliveries are
 * open, for a Helpr with no car yet.
 *
 *   node src/test/pglite/helprTasksOpenCount.pglite.mjs                    # after (3x replay): all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprTasksOpenCount.pglite.mjs # before: RED (no such read)
 *   MUTANT=<name> node src/test/pglite/helprTasksOpenCount.pglite.mjs      # a planted defect: RED
 *
 * Real: the helpr_tasks and helpr_vehicles tables (verbatim, 20261017055505), and the NEWEST
 * helpr_tasks_open_near, helpr_task_vehicle_fits, helpr_task_distance_m and helpr_payout_round_down_cents,
 * so the count is compared with what the listing read shows a Helpr whose vehicle fits everything.
 * Stubbed, and said so: require_feature, helpr_task_source_require_feature (records the call),
 * helpr_task_assert_helpr (not_authenticated for no caller, else auth.uid(); a "gated" caller raises
 * payout_setup_incomplete to prove the gate's refusal reaches the caller), are_users_blocked (a pair table),
 * helpr_task_same_stripe_mode (a test-account table: test and real never match).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261030044539_helpr_tasks_open_count.sql";
const BASE = "20261017055505_declutter_helpr_delivery.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest definition of public.<name> before `before` (any dollar tag). */
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
function table(file, name) {
  const src = readFileSync(MIG_DIR + file, "utf8");
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  return src.slice(start, src.indexOf("\n);", start) + 3);
}

const MUTANTS = {
  // Test data counts for a real member again.
  stripe: ["     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)\n", ""],
  // A blocked seller's delivery is counted.
  blocked: ["     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)\n", ""],
  // The vehicle filter comes back: a Helpr with no car reads zero (the defect this read exists for).
  vehicle: ["     AND NOT public.are_users_blocked(v_uid, t.customer_id)\n", "     AND public.helpr_task_vehicle_fits(v_uid, t.size)\n     AND NOT public.are_users_blocked(v_uid, t.customer_id)\n"],
  // An expired delivery is counted.
  expired: ["   WHERE t.status = 'open' AND t.open_until > now()\n", "   WHERE t.status = 'open'\n"],
  // The Helpr gate is skipped.
  gate: ["  v_uid := public.helpr_task_assert_helpr();\n", "  v_uid := auth.uid();\n"],
  // anon may call it.
  anon: ["REVOKE ALL ON FUNCTION public.helpr_tasks_open_count() FROM PUBLIC, anon;\n", "GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_count() TO anon;\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const U = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const NOCAR = U(1), TRUCK2 = U(2), SELLER = U(3), BUYER = U(4), BLOCKED_SELLER = U(5), TEST_BUYER = U(6), GATED = U(7);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create schema storage;
  create table storage.objects (bucket_id text, name text);
  grant usage on schema auth, public, storage to anon, authenticated, service_role;
  create table public.gate_calls (kind text);
  create table public.blocked_pairs (a uuid, b uuid);
  create table public.test_people (user_id uuid primary key);
  create function public.require_feature(p_key text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_source_require_feature(p_kind text) returns void language sql as
    $f$ insert into public.gate_calls values (p_kind) $f$;
  create function public.helpr_task_assert_helpr() returns uuid language plpgsql as $f$
  begin
    if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
    if auth.uid() = '${GATED}' then raise exception 'payout_setup_incomplete' using errcode = '42501'; end if;
    return auth.uid();
  end $f$;
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocked_pairs where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
  create function public.helpr_task_same_stripe_mode(p_a uuid, p_b uuid) returns boolean language sql stable as
    $f$ select p_a is not null and p_b is not null
           and exists (select 1 from public.test_people where user_id = p_a) = exists (select 1 from public.test_people where user_id = p_b) $f$;
`);
await db.exec(table(BASE, "helpr_vehicles"));
await db.exec(`ALTER TABLE public.helpr_vehicles ADD COLUMN IF NOT EXISTS has_car boolean NOT NULL DEFAULT false;`);
await db.exec(table(BASE, "helpr_tasks"));
await db.exec(`ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS raised_cents integer NOT NULL DEFAULT 0;`);
for (const fn of ["helpr_task_distance_m", "helpr_payout_round_down_cents", "helpr_task_vehicle_fits", "helpr_tasks_open_near"]) await db.exec(newest(fn));

const people = [NOCAR, TRUCK2, SELLER, BUYER, BLOCKED_SELLER, TEST_BUYER, GATED];
await db.exec(`insert into auth.users values ${people.map((u) => `('${u}')`).join(",")}`);
await db.exec(`insert into public.helpr_vehicles (user_id, has_car, has_truck, second_person, photo_path) values ('${TRUCK2}', true, true, true, 'p.jpg')`);
await db.exec(`insert into public.blocked_pairs values ('${NOCAR}', '${BLOCKED_SELLER}'), ('${TRUCK2}', '${BLOCKED_SELLER}')`);
await db.exec(`insert into public.test_people values ('${TEST_BUYER}')`);

let n = 0;
async function task({ area, size = "small", status = "open", open = "now() + interval '1 day'", buyer = BUYER, seller = SELLER }) {
  n++;
  const helpr = status === "open" ? "null" : `'${TRUCK2}'`;
  const slot = status === "open" ? "null" : "now() + interval '1 day'";
  await db.exec(`insert into public.helpr_tasks (source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address,
      pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, customer_id,
      pickup_contact_id, helpr_id, open_until, latest_pickup_at, pickup_slot_start, dropoff_code)
    values ('declutter_delivery', '${U(100 + n)}', '${status}', '${size}', 'Item ${n}', '${area}', 'Baker', '${n} Main St',
      30.45, -91.15, '9 Oak St', 30.5, -91.1, 4, 2000, 170, '${buyer}', '${seller}', ${helpr}, ${open},
      now() + interval '2 days', ${slot}, '1234')`);
}
await task({ area: "Mid City, Baton Rouge" });
await task({ area: "Mid City, Baton Rouge" });
await task({ area: "Broussard, LA", size: "large" });
await task({ area: "Downtown, Baton Rouge", size: "xl" });
// Never counted: expired, taken, the caller's own sale, a blocked seller, a test account's purchase.
await task({ area: "Expired Town", open: "now() - interval '1 minute'" });
await task({ area: "Taken Town", status: "accepted" });
await task({ area: "Own Sale Town", seller: NOCAR });
await task({ area: "Blocked Town", seller: BLOCKED_SELLER });
await task({ area: "Test Town", buyer: TEST_BUYER });

if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

async function as(uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const asMap = (rows) => Object.fromEntries(rows.map((r) => [r.pickup_area, Number(r.open_count ?? r.n)]).sort(([a], [b]) => a.localeCompare(b)));

const listed = await as(NOCAR, "select * from public.helpr_tasks_open_near(null, null, 50)");
check(listed.ok && listed.rows.length === 0, `[why] a Helpr with no car lists no delivery (${listed.rows?.length ?? listed.code})`);

await db.exec("delete from public.gate_calls");
const count = await as(NOCAR, "select * from public.helpr_tasks_open_count()");
check(count.ok, `[count] a Helpr with no car can read the count (${count.code ?? "ok"})`);
const got = count.ok ? asMap(count.rows) : {};
check(JSON.stringify(got) === JSON.stringify({ "Broussard, LA": 1, "Downtown, Baton Rouge": 1, "Mid City, Baton Rouge": 2 }),
  `[count] every open delivery by area, whatever its size: ${JSON.stringify(got)}`);
for (const town of ["Expired Town", "Taken Town", "Own Sale Town", "Blocked Town", "Test Town"]) {
  check(count.ok && !(town in got), `[count] never counts ${town}`);
}
const gateCalls = (await db.query("select kind from public.gate_calls")).rows.map((r) => r.kind);
check(gateCalls.includes("declutter_delivery"), "[gate] the delivery switch is checked first");

// Parity: the count is exactly what the listing read shows a Helpr whose vehicle fits everything.
const full = await as(TRUCK2, "select pickup_area, count(*)::int as n from public.helpr_tasks_open_near(null, null, 50) group by 1");
const fullCount = await as(TRUCK2, "select * from public.helpr_tasks_open_count()");
check(full.ok && fullCount.ok && JSON.stringify(asMap(full.rows)) === JSON.stringify(asMap(fullCount.rows)),
  `[parity] count == open_near grouped by area for a truck + second person: ${JSON.stringify(full.ok ? asMap(full.rows) : full.code)} vs ${JSON.stringify(fullCount.ok ? asMap(fullCount.rows) : fullCount.code)}`);

const cols = count.ok && count.rows[0] ? Object.keys(count.rows[0]).sort().join(",") : "";
check(cols === "open_count,pickup_area", `[shape] area words and a count only, never an address or a point (${cols})`);

const anonymous = await as(null, "select * from public.helpr_tasks_open_count()");
check(!anonymous.ok && /not_authenticated/.test(anonymous.code), `[gate] no caller is refused (${anonymous.code ?? "ok"})`);
const gated = await as(GATED, "select * from public.helpr_tasks_open_count()");
check(!gated.ok && /payout_setup_incomplete/.test(gated.code), `[gate] the Helpr gate's refusal reaches the caller (${gated.code ?? "ok"})`);

const priv = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.helpr_tasks_open_count()', 'execute') p`)).rows[0]?.p;
let anonPriv = null, authPriv = null;
try { anonPriv = await priv("anon"); authPriv = await priv("authenticated"); } catch (e) { anonPriv = `missing: ${e.message}`; }
check(anonPriv === false, `[grant] anon cannot call it (${anonPriv})`);
check(authPriv === true, `[grant] authenticated can (${authPriv})`);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
