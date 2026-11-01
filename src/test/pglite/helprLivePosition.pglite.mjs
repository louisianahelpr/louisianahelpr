#!/usr/bin/env node
/**
 * PGlite proof for *_helpr_live_position (owner 11-01 11:53 AM, delivery live map): the seller sees the Helpr from
 * Start until Picked up, the buyer from Picked up until delivered, with an ETA; one row per delivery, overwritten,
 * deleted on every status change; nobody else reads it.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/helprLivePosition.pglite.mjs
 *   MUTANT=phase|stale|trigger|window|owner|readers node src/test/pglite/helprLivePosition.pglite.mjs   # each must FAIL
 *
 * World: helpr_tasks with the columns the migration reads (the real CHECK on status), the NEWEST definitions before
 * the migration of helpr_task_distance_m and declutter_road_miles read from the migrations, never retyped. Stub:
 * is_caller_banned (a table). The migration then runs verbatim 3x (or once mutated).
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_helpr_live_position.sql"));
if (!FILE) throw new Error("migration *_helpr_live_position.sql not found");
const VERSION = FILE.slice(0, 14);
let FIX = readMigration(FILE);
const MUTANTS = {
  // The phases swapped: the buyer sees the Helpr before Picked up, the seller after.
  phase: ["((t.status = 'accepted' AND t.pickup_contact_id = (SELECT auth.uid()))\n         OR (t.status = 'picked_up' AND t.customer_id = (SELECT auth.uid()))))",
    "((t.status = 'accepted' AND t.customer_id = (SELECT auth.uid()))\n         OR (t.status = 'picked_up' AND t.pickup_contact_id = (SELECT auth.uid()))))"],
  // An old position stays readable.
  stale: ["USING (updated_at > now() - interval '2 minutes' AND ", "USING ("],
  // A status change keeps the row (the buyer would see the seller-phase row with the seller's point).
  trigger: ["    DELETE FROM public.helpr_task_live_positions WHERE task_id = NEW.id;\n", ""],
  // A pickup days away is shared too.
  window: ["AND (t.handed_over_to = v_uid OR now() >= t.pickup_slot_start - interval '2 hours')", ""],
  // Any Helpr writes every delivery in hand.
  owner: ["     WHERE t.helpr_id = v_uid\n       AND (t.status", "     WHERE true\n       AND (t.status"],
  // Anyone signed in reads every row.
  readers: ["AND public.helpr_task_position_viewer(task_id));", ");"],
};
const MUTANT = process.env.MUTANT;
if (MUTANT) {
  for (const m of MUTANT.split(",")) {
    const [find, repl] = MUTANTS[m] ?? [];
    if (!find || !FIX.includes(find)) throw new Error(`mutant ${m}: text not found in the migration`);
    FIX = FIX.replace(find, repl);
  }
  console.log(`MUTANT=${MUTANT}: expect FAILs`);
}
const { P: SELLER, A: HELPR, B: BUYER, C: HELPR2, X: STRANGER } = USERS;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.banned (user_id uuid primary key);
  create function public.is_caller_banned() returns boolean language sql stable security definer as
    $f$ select exists (select 1 from public.banned b where b.user_id = auth.uid()) $f$;
  create table public.helpr_tasks (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'open' check (status in ('open','accepted','picked_up','delivered','confirmed','unfilled','cancelled','failed')),
    pickup_lat numeric not null, pickup_lng numeric not null, dropoff_lat numeric not null, dropoff_lng numeric not null,
    customer_id uuid, pickup_contact_id uuid, helpr_id uuid, pickup_slot_start timestamptz, handed_over_to uuid,
    updated_at timestamptz not null default now());
  revoke all on table public.helpr_tasks from public, anon, authenticated;
`;
const OLD = ["helpr_task_distance_m", "declutter_road_miles"].map((n) => newestFunctionSql(n, VERSION).sql).join("\n");

const db = new PGlite();
await db.exec(WORLD + OLD);
for (let i = 0; i < (MUTANT ? 1 : 3); i++) await db.exec(FIX);
check(MUTANT ? "applies (mutant)" : "applies 3x (replay-safe)", true);

// Pickup in New Iberia, drop-off ~10 km north-east. T1: accepted, pickup in 1 hour. T2: picked up. T3: accepted,
// pickup in 3 days. T4: another Helpr's, accepted, pickup in 1 hour.
const task = async (status, helpr, slot) => (await db.query(`insert into public.helpr_tasks
  (status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id, helpr_id, pickup_slot_start)
  values ('${status}', 30.0035, -91.8187, 30.07, -91.75, '${BUYER}', '${SELLER}', '${helpr}', now() + interval '${slot}')
  returning id`)).rows[0].id;
const T1 = await task("accepted", HELPR, "1 hour");
const T2 = await task("picked_up", HELPR, "-1 hour");
const T3 = await task("accepted", HELPR, "3 days");
const T4 = await task("accepted", HELPR2, "1 hour");
const read = (who, id) => as(db, "authenticated", who, `select lat, lng, dest_lat, dest_lng, eta_minutes from public.helpr_task_live_positions where task_id = '${id}'`);
const started = async (id) => (await db.query(`select started_at from public.helpr_tasks where id = '${id}'`)).rows[0].started_at;

// L1 before Start: nothing shared, nothing started.
check("L1 before Start the seller reads nothing and no delivery is started",
  (await read(SELLER, T1)).rows?.length === 0 && (await started(T1)) === null);

// L2 Start: the Helpr's deliveries in hand (T1 within 2 hours, T2 picked up), not the one 3 days out, not another's.
const s = await as(db, "authenticated", HELPR, `select public.helpr_share_position(30.05, -91.80) n`);
check("L2 share writes the caller's two deliveries in hand", s.ok && s.rows[0].n === 2, JSON.stringify(s));
check("L2b both are started; the one 3 days out is not", !!(await started(T1)) && !!(await started(T2)) && (await started(T3)) === null);
check("L2c another Helpr's delivery is untouched", (await db.query(`select count(*)::int c from public.helpr_task_live_positions where task_id = '${T4}'`)).rows[0].c === 0
  && (await started(T4)) === null);

// L3 seller sees T1 (accepted), heading to their own pickup point.
const r3 = await read(SELLER, T1);
check("L3 the seller sees the Helpr coming (accepted), heading to the pickup",
  r3.ok && r3.rows.length === 1 && Number(r3.rows[0].dest_lat) === 30.0035 && Number(r3.rows[0].lat) === 30.05, JSON.stringify(r3));
// L4 the buyer does not see T1 before Picked up; L5 the buyer sees T2 with the drop-off and an ETA.
check("L4 the buyer does not see the Helpr before Picked up", (await read(BUYER, T1)).rows?.length === 0);
const r5 = await read(BUYER, T2);
check("L5 the buyer sees the Helpr after Picked up, heading to the drop-off, with an ETA",
  r5.ok && r5.rows.length === 1 && Number(r5.rows[0].dest_lat) === 30.07 && r5.rows[0].eta_minutes > 0, JSON.stringify(r5));
check("L6 the seller no longer sees it after Picked up", (await read(SELLER, T2)).rows?.length === 0);
// L7 strangers and the other Helpr see nothing; anon is refused the table.
check("L7 a stranger and another Helpr read nothing",
  (await read(STRANGER, T1)).rows?.length === 0 && (await read(HELPR2, T2)).rows?.length === 0
  && (await as(db, "authenticated", STRANGER, `select * from public.helpr_task_live_positions`)).rows?.length === 0);
check("L7b anon cannot read the table", refused(await as(db, "anon", null, `select * from public.helpr_task_live_positions`), /permission denied/));
// L8 no direct writes, even by the Helpr.
check("L8 no direct insert/update/delete",
  refused(await as(db, "authenticated", HELPR, `update public.helpr_task_live_positions set lat = 1`), /permission denied/)
  && refused(await as(db, "authenticated", HELPR, `delete from public.helpr_task_live_positions`), /permission denied/)
  && refused(await as(db, "authenticated", HELPR, `insert into public.helpr_task_live_positions values ('${T3}', 1, 1, 1, 1, 1, now())`), /permission denied/));
// L9 one row per delivery, overwritten.
await as(db, "authenticated", HELPR, `select public.helpr_share_position(30.06, -91.79)`);
const r9 = await db.query(`select count(*)::int c, max(lat) m from public.helpr_task_live_positions where task_id = '${T1}'`);
check("L9 sharing again overwrites: one row, the newest point", r9.rows[0].c === 1 && Number(r9.rows[0].m) === 30.06);
// L10 Picked up deletes the seller-phase row: the buyer never sees the seller's point.
await db.exec(`update public.helpr_tasks set status = 'picked_up' where id = '${T1}'`);
check("L10 Picked up deletes the row (the buyer sees nothing until the next share)",
  (await db.query(`select count(*)::int c from public.helpr_task_live_positions where task_id = '${T1}'`)).rows[0].c === 0
  && (await read(BUYER, T1)).rows?.length === 0 && !!(await started(T1)));
await as(db, "authenticated", HELPR, `select public.helpr_share_position(30.06, -91.79)`);
const r10 = await read(BUYER, T1);
check("L10b after the next share the buyer sees it, heading to the drop-off", r10.rows?.length === 1 && Number(r10.rows[0].dest_lat) === 30.07);
// L11 delivered deletes it; nothing is kept.
await db.exec(`update public.helpr_tasks set status = 'delivered' where id = '${T1}'`);
check("L11 delivered deletes the row and clears started",
  (await db.query(`select count(*)::int c from public.helpr_task_live_positions where task_id = '${T1}'`)).rows[0].c === 0 && (await started(T1)) === null);
// L12 a released delivery (back to open) keeps nothing.
await as(db, "authenticated", HELPR2, `select public.helpr_share_position(30.0, -91.8)`);
await db.exec(`update public.helpr_tasks set status = 'open', helpr_id = null where id = '${T4}'`);
check("L12 released: row deleted, started cleared",
  (await db.query(`select count(*)::int c from public.helpr_task_live_positions where task_id = '${T4}'`)).rows[0].c === 0 && (await started(T4)) === null);
// L13 a position older than 2 minutes is hidden.
await db.exec(`update public.helpr_task_live_positions set updated_at = now() - interval '3 minutes' where task_id = '${T2}'`);
check("L13 a position older than 2 minutes is hidden", (await read(BUYER, T2)).rows?.length === 0);
// L14 Stop deletes only the caller's rows.
await as(db, "authenticated", HELPR, `select public.helpr_share_position(30.06, -91.79)`);
const t5 = await task("accepted", HELPR2, "30 minutes");
await as(db, "authenticated", HELPR2, `select public.helpr_share_position(30.0, -91.8)`);
const st = await as(db, "authenticated", HELPR, `select public.helpr_stop_sharing() n`);
const left = (await db.query(`select task_id from public.helpr_task_live_positions`)).rows.map((r) => r.task_id);
check("L14 Stop deletes the caller's rows only", st.ok && st.rows[0].n === 1 && left.length === 1 && left[0] === t5, JSON.stringify({ st, left }));
// L15 refusals: bad point, banned, anon.
check("L15 a bad point is refused", refused(await as(db, "authenticated", HELPR, `select public.helpr_share_position(91, 0)`), /bad_position/)
  && refused(await as(db, "authenticated", HELPR, `select public.helpr_share_position(null, 0)`), /bad_position/));
await db.exec(`insert into public.banned values ('${HELPR}')`);
check("L15b a restricted account is refused", refused(await as(db, "authenticated", HELPR, `select public.helpr_share_position(30, -91)`), /account_restricted/));
check("L15c anon cannot share or stop",
  refused(await as(db, "anon", null, `select public.helpr_share_position(30, -91)`), /permission denied/)
  && refused(await as(db, "anon", null, `select public.helpr_stop_sharing()`), /permission denied/));
// L16 a handed-over pickup days away is shared (the seller handed it to this Helpr).
await db.exec(`delete from public.banned; update public.helpr_tasks set handed_over_to = '${HELPR}' where id = '${T3}'`);
await as(db, "authenticated", HELPR, `select public.helpr_share_position(30.01, -91.81)`);
check("L16 a pickup handed over to the Helpr is shared even days ahead", (await read(SELLER, T3)).rows?.length === 1);

const f = failures();
console.log(f ? `\n${f} FAIL(s)` : "\nall PASS");
process.exit(f ? 1 : 0);
