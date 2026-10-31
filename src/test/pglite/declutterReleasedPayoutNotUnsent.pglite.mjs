#!/usr/bin/env node
/**
 * PGlite proof for 20261031204932_declutter_released_payout_not_unsent (LEAD-PAYOUT-RELEASE-UNSENT, B27 10-31): a
 * Declutter payout an admin released (admin_payout_release, which since 20261031200034 puts it back to 'pending'
 * with attempts = 0) is never "unsent" again, so a later refund cannot rebook it and the problem paths stay closed.
 *
 *   node src/test/pglite/declutterReleasedPayoutNotUnsent.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReleasedPayoutNotUnsent.pglite.mjs  # RED: the newest bodies before it
 *
 * World: declutter_payout_unsent, admin_payout_release and declutter_rebook_payout loaded from their NEWEST CREATE
 * (before this migration when skipped; with it, this migration's own file applied 3x), on tables with the columns they
 * read. Stubbed, and said so: has_role (a table of admins), declutter_consume_fee_debt (0: no fee debt). Neither
 * decides whether a payout is unsent. [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031204932_declutter_released_payout_not_unsent.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration before `upTo` (or up to and including it with `incl`), any dollar-quote tag. */
function newest(name, upTo, incl) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (incl ? FILES[i] > upTo : FILES[i] >= upTo) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition up to ${upTo}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const ADMIN = "11111111-1111-1111-1111-111111111111";
const SELLER = "22222222-2222-2222-2222-222222222222";
const O_REL = "a0000000-0000-4000-8000-000000000001";
const O_NEW = "a0000000-0000-4000-8000-000000000002";
const O_SENT = "a0000000-0000-4000-8000-000000000003";
const O_OTHER = "a0000000-0000-4000-8000-000000000004";
const P_REL = "b0000000-0000-4000-8000-000000000001";
const P_NEW = "b0000000-0000-4000-8000-000000000002";
const P_SENT = "b0000000-0000-4000-8000-000000000003";
const P_OTHER = "b0000000-0000-4000-8000-000000000004";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.admins (user_id uuid primary key);
  insert into public.admins values ('${ADMIN}');
  create function public.has_role(u uuid, r text) returns boolean language sql stable as
    $f$ select r = 'admin' and exists (select 1 from public.admins a where a.user_id = u) $f$;
  create table public.declutter_orders (id uuid primary key, status text, close_reason text);
  create table public.declutter_payouts (id uuid primary key, order_id uuid, seller_id uuid, items_cents int, delivery_cents int,
    refunded_cents int default 0, debt_cents int default 0, amount_cents int, status text, stripe_transfer_id text,
    attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
    review_reason text, review_held_at timestamptz);
  create table public.helpr_task_payouts (id uuid primary key, status text, attempts int, next_attempt_at timestamptz,
    review_reason text, review_held_at timestamptz);
  create table public.shop_orders (id uuid primary key, status text, close_reason text);
  create table public.shop_payouts (id uuid primary key, order_id uuid, status text, next_attempt_at timestamptz, attempts int,
    review_reason text, review_held_at timestamptz);
  create table public.shop_refunds (id uuid primary key, order_id uuid, status text, next_attempt_at timestamptz, attempts int,
    reversals int default 0, review_reason text, review_held_at timestamptz);
  create table public.declutter_refunds (id uuid primary key, status text, next_attempt_at timestamptz, review_reason text, review_held_at timestamptz);
  create table public.declutter_delivery_refunds (id uuid primary key, status text, next_attempt_at timestamptz, review_reason text, review_held_at timestamptz);
  create table public.shop_handovers (order_id uuid, problem_at timestamptz, confirmed_how text);
  create function public.shop_order_unaccounted_hand_refund(o uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.payout_payee_waits (payout_kind text, payout_id uuid);
  create table public.payout_send_marks (payout_kind text, payout_id uuid);
  create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid, action text,
    target_type text, target_id text, details jsonb, created_at timestamptz not null default now());
  create table public.declutter_seller_fee_debts (id uuid primary key, seller_id uuid, remaining_cents int);
  create table public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents int);
  create function public.declutter_consume_fee_debt(s uuid, r text, c int) returns int language sql as $f$ select 0 $f$;
  insert into public.declutter_orders values ('${O_REL}', 'handed_over', null), ('${O_NEW}', 'handed_over', null),
    ('${O_SENT}', 'handed_over', null), ('${O_OTHER}', 'handed_over', null);
  -- Held for review on its last try (to be released), a fresh untouched one, one with a send mark, and one that a
  -- release of ANOTHER kind (a helpr_task payout with the same id text) must not touch.
  insert into public.declutter_payouts (id, order_id, seller_id, items_cents, delivery_cents, amount_cents, status, attempts)
    values ('${P_REL}', '${O_REL}', '${SELLER}', 4000, 0, 4000, 'held_for_review', 12),
           ('${P_NEW}', '${O_NEW}', '${SELLER}', 3000, 0, 3000, 'pending', 0),
           ('${P_SENT}', '${O_SENT}', '${SELLER}', 2000, 0, 2000, 'pending', 0),
           ('${P_OTHER}', '${O_OTHER}', '${SELLER}', 1000, 0, 1000, 'pending', 0);
  insert into public.payout_send_marks values ('declutter', '${P_SENT}');
  insert into public.admin_audit_log (admin_id, action, target_type, target_id) values ('${ADMIN}', 'admin_payout_release', 'helpr_task', '${P_OTHER}');
`);

const NAMES = ["declutter_payout_unsent", "admin_payout_release", "declutter_rebook_payout"];
const defs = NAMES.map((n) => newest(n, THIS, !SKIP));
for (const d of defs) console.log(`      loaded ${d.sql.slice(27, d.sql.indexOf("("))} from ${d.file}`);
if (SKIP) {
  for (const d of defs) await db.exec(d.sql);
  // The grants as their files set them.
  await db.exec(`REVOKE ALL ON FUNCTION public.declutter_payout_unsent(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.declutter_payout_unsent(uuid) TO service_role;`);
} else {
  check(defs[0].file === THIS, "[keep] declutter_payout_unsent's newest CREATE is this migration");
  // Restated from the NEWEST CREATE before it: only the release line is added.
  const strip = (s) => s.replace(/--[^\n]*/g, "")
    .replace(/AND NOT EXISTS \(SELECT 1 FROM public\.admin_audit_log a\s+WHERE a\.action = 'admin_payout_release' AND a\.target_type = 'declutter' AND a\.target_id = p\.id::text\)/, "")
    .replace(/\s+/g, " ");
  check(strip(newest(NAMES[0], THIS, false).sql) === strip(defs[0].sql), "[keep] restated from its newest CREATE, only the release line added");
  await db.exec(defs[1].sql);
  await db.exec(defs[2].sql);
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
}
await db.exec(`REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;`);

const unsent = async (o) => (await db.query(`select public.declutter_payout_unsent('${o}'::uuid) as u`)).rows[0].u;
const rebook = async (o, cents) => { try { await db.query(`select public.declutter_rebook_payout('${o}'::uuid, ${cents})`); return "ok"; } catch (e) { return e.message; } };

check((await unsent(O_REL)) === false, "[keep] held on its last try: not unsent");
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
const rel = await db.query(`select public.admin_payout_release('declutter', '${P_REL}', 'payee fixed their account', true) as r`).then((r) => r.rows[0].r, (e) => ({ error: e.message }));
await db.exec("reset role;");
check(rel.result === "released", `[keep] the admin's release answers released ${rel.error ?? ""}`);
const relRow = (await db.query(`select status, attempts from public.declutter_payouts where id = '${P_REL}'`)).rows[0];
check(relRow.status === "pending" && relRow.attempts === 0, "[keep] released: pending with a fresh run of tries (20261031200034)");
check((await unsent(O_REL)) === false, "[fix] released by an admin: NOT unsent, though pending at 0 tries");
const rb = await rebook(O_REL, 1000);
check(/payout_already_sent/.test(rb), `[fix] a later refund cannot rebook the released payout (got: ${rb})`);
check(Number((await db.query(`select amount_cents from public.declutter_payouts where id = '${P_REL}'`)).rows[0].amount_cents) === 4000,
  "[fix] the released amount stands (4000)");

check((await unsent(O_NEW)) === true, "[keep] a fresh untouched payout is unsent");
check((await unsent(O_OTHER)) === true, "[keep] a release of another kind with the same id text does not count");
check((await unsent(O_SENT)) === false, "[keep] a payout with a send mark is not unsent");
check((await rebook(O_NEW, 500)) === "ok", "[keep] an untouched payout still rebooks after a refund");
check(Number((await db.query(`select amount_cents from public.declutter_payouts where id = '${P_NEW}'`)).rows[0].amount_cents) === 2500,
  "[keep] rebooked amount is items - refund (2500)");

const g = (await db.query(`select has_function_privilege('anon', 'public.declutter_payout_unsent(uuid)', 'execute') as a,
  has_function_privilege('authenticated', 'public.declutter_payout_unsent(uuid)', 'execute') as m,
  has_function_privilege('service_role', 'public.declutter_payout_unsent(uuid)', 'execute') as s`)).rows[0];
check(!g.a && !g.m && g.s, "[keep] grants: service_role only");
const idx = (await db.query(`select count(*)::int as n from pg_indexes where indexname = 'admin_audit_log_payout_release_idx'`)).rows[0].n;
check(SKIP || idx === 1, "[keep] the release lookup has its partial index");

console.log(failures ? `\n${failures} FAILED${SKIP ? " (expected: NEW_MIGRATION=skip is the before state)" : ""}` : "\nALL PASS");
process.exit(failures ? 1 : 0);
