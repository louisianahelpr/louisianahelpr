#!/usr/bin/env node
/**
 * PGlite proof for 20261031082821_helpr_open_count_and_windows_hide_backed_out (BUY-41 follow-up, lead 10-31).
 *
 *   node src/test/pglite/helprOpenCountAndWindowsHideBackedOut.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/helprOpenCountAndWindowsHideBackedOut.pglite.mjs  # RED: the newest before it
 *
 * World (as helprOpenDeliveriesHideBackedOut.pglite.mjs): helpr_tasks / helpr_task_events / declutter_problems /
 * declutter_orders / declutter_pickup_windows with the columns read, the REAL helpr_task_source_held and the REAL
 * helpr_tasks_open_near (newest CREATE, 20261031075157), and helpr_tasks_open_count + helpr_task_pickup_windows: the
 * newest CREATE before this migration (SKIP) or this migration's file, run verbatim 3 times. Stubbed, and said so:
 * helpr_task_source_require_feature (no-op), helpr_task_assert_helpr (the GUC test.uid), helpr_task_distance_m (0),
 * helpr_payout_round_down_cents (identity), helpr_task_vehicle_fits, are_users_blocked, helpr_task_same_stripe_mode
 * (always fit / not blocked / same mode). Not read against prod.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031082821_helpr_open_count_and_windows_hide_backed_out.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

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

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SELLER = "33333333-3333-3333-3333-333333333333";
const BUYER = "44444444-4444-4444-4444-444444444444";
const T_PLAIN = "a0000000-0000-0000-0000-000000000001";
const T_RELEASED = "a0000000-0000-0000-0000-000000000002";
const T_MISSED = "a0000000-0000-0000-0000-000000000003";
const T_HELD = "a0000000-0000-0000-0000-000000000004";
const T_OTHERS_RELEASE = "a0000000-0000-0000-0000-000000000005";
const ORDER = (n) => `b0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE TABLE public.helpr_tasks (
    id uuid PRIMARY KEY, source_kind text, source_id uuid, status text, size text, title text,
    pickup_area text, dropoff_area text, trip_miles integer, pickup_lat numeric, pickup_lng numeric,
    pay_cents integer, fee_cents integer, open_until timestamptz, latest_pickup_at timestamptz,
    customer_id uuid, pickup_contact_id uuid);
  CREATE TABLE public.helpr_task_events (id bigserial PRIMARY KEY, task_id uuid, task_event text, actor_id uuid);
  CREATE TABLE public.declutter_problems (id bigserial PRIMARY KEY, order_id uuid, status text);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, paid_at timestamptz);
  CREATE TABLE public.declutter_pickup_windows (seller_id uuid, weekday smallint, starts_local time, ends_local time);
  CREATE FUNCTION public.helpr_task_source_require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.helpr_task_assert_helpr() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.uid')::uuid $$;
  CREATE FUNCTION public.helpr_task_distance_m(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
  CREATE FUNCTION public.helpr_payout_round_down_cents(integer) RETURNS integer LANGUAGE sql AS $$ SELECT $1 $$;
  CREATE FUNCTION public.helpr_task_vehicle_fits(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
await db.exec(newest("helpr_task_source_held").sql);
await db.exec(newest("helpr_tasks_open_near").sql);

const task = (id, n) => `('${id}', 'declutter_delivery', '${ORDER(n)}', 'open', 'small', 'Lamp ${n}', 'Mid City', 'Garden District', 3,
  30.45, -91.15, 2500, 500, now() + interval '2 days', now() + interval '2 days', '${BUYER}', '${SELLER}')`;
await db.exec(`
  INSERT INTO public.helpr_tasks VALUES ${task(T_PLAIN, 1)}, ${task(T_RELEASED, 2)}, ${task(T_MISSED, 3)}, ${task(T_HELD, 4)}, ${task(T_OTHERS_RELEASE, 5)};
  INSERT INTO public.declutter_orders VALUES ${[1, 2, 3, 4, 5].map((n) => `('${ORDER(n)}', '${SELLER}', now())`).join(", ")};
  INSERT INTO public.declutter_pickup_windows VALUES ('${SELLER}', 1, '09:00', '12:00');
  INSERT INTO public.helpr_task_events (task_id, task_event, actor_id) VALUES
    ('${T_RELEASED}', 'accepted', '${ME}'), ('${T_RELEASED}', 'released', '${ME}'),
    ('${T_MISSED}', 'accepted', '${ME}'), ('${T_MISSED}', 'helpr_no_show', '${ME}'),
    ('${T_OTHERS_RELEASE}', 'accepted', '${OTHER}'), ('${T_OTHERS_RELEASE}', 'released', '${OTHER}');
  INSERT INTO public.declutter_problems (order_id, status) VALUES ('${ORDER(4)}', 'open'), ('${ORDER(1)}', 'decided');
`);

if (SKIP) {
  for (const fn of ["helpr_tasks_open_count", "helpr_task_pickup_windows"]) {
    const d = newest(fn);
    await db.exec(d.sql);
    console.log(`before: ${fn} from ${d.file}`);
  }
} else {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log(`after: ${THIS}, applied 3x`);
}

async function as(uid) { await db.exec(`SET test.uid = '${uid}'`); }
async function listed(uid) {
  await as(uid);
  return (await db.query("SELECT task_id FROM public.helpr_tasks_open_near(30.45, -91.15, 50)")).rows.length;
}
async function counted(uid) {
  await as(uid);
  return (await db.query("SELECT open_count FROM public.helpr_tasks_open_count()")).rows.reduce((a, r) => a + r.open_count, 0);
}
async function windows(uid, taskId) {
  await as(uid);
  try {
    return (await db.query(`SELECT * FROM public.helpr_task_pickup_windows('${taskId}')`)).rows.length;
  } catch (e) {
    return String(e.message);
  }
}

const myList = await listed(ME);
const myCount = await counted(ME);
const otherCount = await counted(OTHER);
check(myList === 2, `[keep] the list shows me 2 (plain + another Helpr's back-out); got ${myList}`);
check(myCount === myList, `[fix] the count is the list (minus only the vehicle fit): ${myCount} counted, ${myList} listed`);
check(otherCount === 3, `[fix] another Helpr: my back-out and miss count for them, the held sale does not (3); got ${otherCount}`);
check((await windows(ME, T_PLAIN)) === 1, "[keep] pickup times of a delivery I can take");
check((await windows(ME, T_OTHERS_RELEASE)) === 1, "[keep] another Helpr's back-out does not hide its times from me");
check(/task_not_found/.test(String(await windows(ME, T_RELEASED))), "[fix] no pickup times for a delivery I released");
check(/task_not_found/.test(String(await windows(ME, T_MISSED))), "[fix] no pickup times for a delivery I missed");
check(/task_not_found/.test(String(await windows(ME, T_HELD))) && /task_not_found/.test(String(await windows(OTHER, T_HELD))),
  "[fix] no pickup times for a delivery whose sale is held, for anyone");
check((await windows(OTHER, T_RELEASED)) === 1, "[keep] my back-out keeps its times for other Helprs");
for (const fn of ["helpr_tasks_open_count", "helpr_task_pickup_windows"]) {
  const acl = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = '${fn}'`)).rows[0].acl ?? "";
  check(SKIP || (!/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl)), `[keep] ${fn}: no EXECUTE for PUBLIC or anon`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
