#!/usr/bin/env node
/**
 * PGlite proof for 20261101051951_tips_wait_for_helpr_id (BUY-43; owner 2026-10-30: tips are blocked until the Helpr
 * is verified, and no money is taken until then).
 *
 *   node src/test/pglite/tipsWaitForHelprId.pglite.mjs                     # after (3x replay): all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/tipsWaitForHelprId.pglite.mjs  # before: RED
 *   B43_MUTANT=<start|open> node src/test/pglite/tipsWaitForHelprId.pglite.mjs  # a planted defect: RED
 *
 * World: helprTaskTips.pglite.mjs's world (the REAL helpr_tasks / helpr_task_payouts tables and the REAL
 * 20261028014848 tips migration), then this migration. Stubbed, and said so: payout_waits_on_identity reads a table
 * (public.id_owed) so the "ID still owed" state can be driven; its real body (20261031220849) is FALSE while the
 * identity_check switch is off and is proven in its own PGlite. declutter_delivery_tip_open's order tables are
 * minimal (the columns it reads).
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
const THIS = "20261028014848_helpr_task_tips.sql";
const BASE = "20261017055505_declutter_helpr_delivery.sql";
const MUTANT = "";
const skip = false;

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
  return src.slice(start, src.indexOf("\n);", start) + 3);
}

let mig = readFileSync(MIG_DIR + THIS, "utf8");

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const U = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), HELPR = U(3), STRANGER = U(4), BANNED = U(5), OFF = U(6), ENEMY = U(7), SEEDBUYER = U(8), NEWHELPR = U(9);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, full_name text, is_seed boolean default false, stripe_account_id text);
  create table public.declutter_orders (id uuid primary key, stripe_payment_intent_id text);
  create table public.declutter_delivery_raises (id uuid primary key, task_id uuid, status text, stripe_payment_intent_id text, raise_cents int, applied_at timestamptz);
  create function public.declutter_order_refunds_recorded_cents(p uuid) returns integer language sql stable as $f$ select 0 $f$;
  create function public.helpr_task_source_held(p_kind text, p_source uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.notifications (id bigint generated always as identity, user_id uuid, type text, title text, message text, link text);
  create table public.banned (user_id uuid primary key);
  create function public.is_caller_banned() returns boolean language sql stable as
    $f$ select exists (select 1 from public.banned where user_id = auth.uid()) $f$;
  create table public.switch_off (user_id uuid primary key);
  create function public.helpr_task_source_require_feature(p_kind text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if;
  end $f$;
  create table public.blocks (a uuid, b uuid);
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
`);
await db.exec(table(BASE, "helpr_tasks"));
await db.exec(`ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS raised_cents integer NOT NULL DEFAULT 0;`);
await db.exec(table(BASE, "helpr_task_payouts"));
// 20261019070737's statuses (held_for_review, settled_by_hand), as on prod.
await db.exec(`ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_status_check;
  ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));`);
for (const fn of ["helpr_task_rows_seed", "declutter_notify", "member_display_name"]) await db.exec(newest(fn));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const people = [BUYER, SELLER, HELPR, STRANGER, BANNED, OFF, ENEMY, SEEDBUYER, NEWHELPR];
await db.exec(`insert into auth.users values ${people.map((u) => `('${u}')`).join(",")}`);
await db.exec(`insert into public.profiles (user_id, full_name, is_seed) values
  ('${BUYER}', 'Pat Lemoine', false), ('${SELLER}', 'Sam Seller', false), ('${HELPR}', 'Hank Helpr', false), ('${STRANGER}', 'Stu Ranger', false),
  ('${BANNED}', 'Ban Ned', false), ('${OFF}', 'Off Switch', false), ('${ENEMY}', 'En Emy', false), ('${SEEDBUYER}', 'Seed Buyer', true),
  ('${NEWHELPR}', 'Nia Newhelpr', false)`);
// HELPR has a payout account; NEWHELPR has none yet (owner #3706: their tip is held with their delivery pay).
await db.exec(`update public.profiles set stripe_account_id = 'acct_hank' where user_id = '${HELPR}'`);
await db.exec(`insert into public.banned values ('${BANNED}'); insert into public.switch_off values ('${OFF}');`);

let n = 0;
async function task(o) {
  const id = `bbbbbbbb-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const st = o.status ?? "confirmed";
  const taken = ["accepted", "picked_up", "delivered", "confirmed"].includes(st);
  await db.query(`insert into public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, customer_id, pickup_contact_id, helpr_id, open_until, latest_pickup_at,
      pickup_slot_start, accepted_at, picked_up_at, pickup_photo_path, delivered_at, dropoff_photo_path, confirmed_at, confirmed_by, dropoff_code, is_seed)
    values ($1, 'declutter_delivery', $1, $2, 'small', 'Oak dresser', 'Mid City', 'Shenandoah', '1 Seller St', 30.45, -91.15, '1 Buyer Ln', 30.40, -91.05,
      6, 2500, 195, $3, $4, $5, now() + interval '1 day', now() + interval '3 days', $6, $6, $7, $8, $9, $10, $11, $12, '1234', $13)`,
    [id, st, o.customer ?? BUYER, SELLER, taken ? (o.helpr === undefined ? HELPR : o.helpr) : null,
     taken ? new Date(Date.now() - 86_400_000).toISOString() : null,
     ["picked_up", "delivered", "confirmed"].includes(st) ? new Date().toISOString() : null,
     ["picked_up", "delivered", "confirmed"].includes(st) ? `${HELPR}/task/${id}/p.jpg` : null,
     ["delivered", "confirmed"].includes(st) ? new Date().toISOString() : null,
     ["delivered", "confirmed"].includes(st) ? `${HELPR}/task/${id}/d.jpg` : null,
     st === "confirmed" ? new Date().toISOString() : null, st === "confirmed" ? "customer" : null, o.seed ?? false]);
  return id;
}
async function as(uid, sql, params = []) {
  try {
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${uid ? "authenticated" : "anon"};`);
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  } finally {
    await db.exec(`RESET ROLE; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const svc = async (sql, params = []) => {
  try { await db.exec("SET ROLE service_role"); return { ok: true, rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { ok: false, code: String(e.message) }; }
  finally { await db.exec("RESET ROLE"); }
};
const A1 = "cccccccc-0000-0000-0000-000000000001", A2 = "cccccccc-0000-0000-0000-000000000002";
const start = (uid, t, cents = 1000, attempt = A1) => as(uid, "select public.helpr_task_tip_start($1, $2, $3) as r", [t, cents, attempt]);
const refused = (r, re) => !r.ok && re.test(r.code);


const B43 = "20261101051951_tips_wait_for_helpr_id.sql";
let fix = readFileSync(MIG_DIR + B43, "utf8");
const B43_MUTANTS = {
  start: ["  IF public.payout_waits_on_identity(t.helpr_id) THEN", "  IF false THEN"],
  open: ["       AND NOT public.payout_waits_on_identity(t.helpr_id)\n", ""],
};
if (process.env.B43_MUTANT) {
  const m = B43_MUTANTS[process.env.B43_MUTANT];
  if (!m || !fix.includes(m[0])) throw new Error(`mutant ${process.env.B43_MUTANT} did not apply`);
  fix = fix.replace(m[0], m[1]);
}
await db.exec(`
  create table public.id_owed (user_id uuid primary key);
  create function public.payout_waits_on_identity(p uuid) returns boolean language sql stable security definer as
    $f$ select exists (select 1 from public.id_owed where user_id = p) $f$;
  revoke all on function public.payout_waits_on_identity(uuid) from public, anon, authenticated;
  create table public.declutter_order_deliveries (order_id uuid, task_id uuid);
`);
// declutter_delivery_tip_open reads declutter_orders (id, buyer_id, handover): the harness's table gets the two columns.
await db.exec(`alter table public.declutter_orders add column if not exists buyer_id uuid; alter table public.declutter_orders add column if not exists handover text;`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(fix);
check(true, "applies 3x (replay-safe)");

const tipRows = async (t) => Number((await db.query(`select count(*)::int n from public.helpr_task_tips where task_id = $1`, [t])).rows[0].n);
const OWED = await task({});
await db.exec(`insert into public.id_owed values ('${HELPR}')`);
const r1 = await start(BUYER, OWED);
check(refused(r1, /tip_waits_on_identity/), `[id] the Helpr's ID check is still owed: the tip is refused (tip_waits_on_identity)${r1.ok ? " (allowed)" : ""}`);
check((await tipRows(OWED)) === 0, "[id] no tip row is written, so declutter-checkout never opens a Stripe page (no money taken)");
await db.exec(`delete from public.id_owed`);
const r2 = await start(BUYER, OWED);
check(r2.ok && r2.rows[0].r.tip_id && (await tipRows(OWED)) === 1, `[id] once the Helpr is verified the same tip starts${r2.ok ? "" : ` (${r2.code})`}`);
check(refused(await start(STRANGER, OWED), /task_not_found/), "[kept] a stranger is still told the delivery doesn't exist (checks before the new one unchanged)");

// The notices' "You can add a tip" line.
const ORDER = "dddddddd-0000-0000-0000-000000000001";
await db.query(`insert into public.declutter_orders (id, buyer_id, handover) values ($1, $2, 'delivery')`, [ORDER, BUYER]);
await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [ORDER, OWED]);
const open = async () => (await db.query(`select public.declutter_delivery_tip_open($1) as v`, [ORDER])).rows[0].v;
check((await open()) === true, "[open] a verified Helpr's done delivery offers the tip line");
await db.exec(`insert into public.id_owed values ('${HELPR}')`);
check((await open()) === false, "[open] while the Helpr's ID check is owed the tip line is not offered");
await db.exec(`delete from public.id_owed`);

await db.close();
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log("ALL CHECKS PASSED");
