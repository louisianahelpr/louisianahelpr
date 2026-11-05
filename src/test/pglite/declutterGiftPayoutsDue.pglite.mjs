#!/usr/bin/env node
/**
 * Q2106 S2 (PGlite proof for 20261105032500_declutter_gift_payouts): the three payout queues declutter-money pays a
 * Declutter order from (declutter_payouts_due, declutter_manager_payouts_due, helpr_task_payouts_due) return the
 * order's gift_cents, so a gift-paid order's payees are sent from the platform balance under giftCovers. Each body is
 * the newest definition VERBATIM plus that one column: every other column of every row is identical to the old body's
 * answer (compared row by row on the same data, card-only, mixed and gift-only orders); a job's Helpr row answers 0.
 * Grants: service_role only. The file replays 3x.
 *
 *   node src/test/pglite/declutterGiftPayoutsDue.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftPayoutsDue.pglite.mjs  # RED: no gift_cents column
 *
 * Real: the three bodies (old: newest before this file; new: this file applied for real). Stubbed, said so: the tables
 * reduced to the columns read; declutter_order_refunds_recorded_cents, declutter_sale_final and helpr_task_source_held
 * are fixed stand-ins (0, true, false). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261105032500_declutter_gift_payouts.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const FNS = ["declutter_payouts_due", "declutter_manager_payouts_due", "helpr_task_payouts_due"];

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before `before`, any dollar-quote tag. */
function newest(name, before) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const m = [...src.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"))].pop();
    if (!m) continue;
    const start = m.index;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text, gift_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, attempts integer DEFAULT 0,
    status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute', review_held_at timestamptz);
  CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, manager_id uuid, seller_payout_id uuid,
    amount_cents integer, attempts integer DEFAULT 0, status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute');
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_refunds (order_id uuid, stripe_payment_intent_id text, reason text, status text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text, source_id uuid, customer_id uuid, pickup_contact_id uuid, raised_cents integer DEFAULT 0);
  CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY, task_id uuid, helpr_id uuid, amount_cents integer, attempts integer DEFAULT 0,
    status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute');
  CREATE TABLE public.declutter_delivery_raises (id uuid PRIMARY KEY, task_id uuid, stripe_payment_intent_id text, raise_cents integer, status text, applied_at timestamptz);
  CREATE TABLE public.helpr_task_tips (id uuid PRIMARY KEY, task_id uuid, stripe_payment_intent_id text, tip_cents integer, held boolean,
    payment_status text, payout_transfer_id text, paid_at timestamptz);
  CREATE FUNCTION public.declutter_order_refunds_recorded_cents(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_sale_final(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.helpr_task_source_held(text, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
// Data: three orders (card-only, mixed, gift-only), each with a seller, a manager and a delivery Helpr; and a job task.
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const orders = [[1, "pi_card", 0], [2, "pi_mixed", 2500], [3, null, 4000]];
for (const [n, pi, gift] of orders) {
  await db.query(`INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT DO NOTHING`,
    [u(100 + n), `acct_s${n}`, u(200 + n), `acct_m${n}`, u(300 + n), `acct_h${n}`]);
  await db.query(`INSERT INTO public.declutter_orders VALUES ($1, $2, $3, $4)`, [u(n), u(900), pi, gift]);
  await db.query(`INSERT INTO public.declutter_payouts (id, order_id, seller_id, amount_cents) VALUES ($1, $2, $3, 2800)`, [u(10 + n), u(n), u(100 + n)]);
  await db.query(`INSERT INTO public.declutter_manager_payouts (id, order_id, seller_id, manager_id, seller_payout_id, amount_cents) VALUES ($1, $2, $3, $4, $5, 400)`,
    [u(20 + n), u(n), u(100 + n), u(200 + n), u(10 + n)]);
  await db.query(`INSERT INTO public.helpr_tasks (id, source_kind, source_id, customer_id, pickup_contact_id) VALUES ($1, 'declutter_delivery', $2, $3, $4)`,
    [u(30 + n), u(n), u(900), u(100 + n)]);
  await db.query(`INSERT INTO public.helpr_task_payouts (id, task_id, helpr_id, amount_cents) VALUES ($1, $2, $3, 640)`, [u(40 + n), u(30 + n), u(300 + n)]);
}
await db.query(`INSERT INTO public.helpr_tasks (id, source_kind, source_id) VALUES ($1, 'job', $2)`, [u(50), u(51)]);
await db.query(`INSERT INTO public.helpr_task_payouts (id, task_id, helpr_id, amount_cents) VALUES ($1, $2, $3, 500)`, [u(52), u(50), u(301)]);

const rows = async (fn) => (await db.query(`SELECT * FROM public.${fn}(100)`)).rows;
// The old bodies' answers, on the same data.
for (const fn of FNS) await db.exec(newest(fn, THIS));
const before = Object.fromEntries(await Promise.all(FNS.map(async (fn) => [fn, await rows(fn)])));
check(before.declutter_payouts_due.length === 3 && before.declutter_manager_payouts_due.length === 3 && before.helpr_task_payouts_due.length === 4,
  "the old bodies answer every row (inventory non-empty)", JSON.stringify(Object.values(before).map((r) => r.length)));

if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check(true, "the migration replays 3x");
}

const key = (r) => String(r.payout_id);
const giftByOrder = { [u(1)]: 0, [u(2)]: 2500, [u(3)]: 4000 };
for (const fn of FNS) {
  const after = await rows(fn);
  check(after.length === before[fn].length, `${fn}: the same rows`, `${after.length} vs ${before[fn].length}`);
  const old = new Map(before[fn].map((r) => [key(r), r]));
  let same = true;
  let gift = true;
  for (const r of after) {
    const { gift_cents, ...rest } = r;
    if (JSON.stringify(rest) !== JSON.stringify(old.get(key(r)))) same = false;
    const orderId = fn === "helpr_task_payouts_due" ? (r.source_kind === "declutter_delivery" ? String(r.source_id) : null) : String(r.order_id);
    const want = orderId ? giftByOrder[orderId] : 0;
    if (gift_cents !== want) gift = false;
  }
  check(same, `${fn}: every other column is the old body's answer`);
  check(gift, `${fn}: gift_cents is the order's gift (0 card-only, 2500 mixed, 4000 gift-only; a job's row 0)`,
    JSON.stringify(after.map((r) => r.gift_cents)));
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.${fn}(integer)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.${fn}(integer)', 'EXECUTE') u, has_function_privilege('service_role', 'public.${fn}(integer)', 'EXECUTE') s`)).rows[0];
  check(!acl.a && !acl.u && acl.s, `${fn}: grants service_role only`, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
