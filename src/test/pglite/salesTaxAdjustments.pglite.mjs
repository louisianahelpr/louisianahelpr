#!/usr/bin/env node
/**
 * PGlite proof for 20261105021744_sales_tax_adjustments.sql (Q1918 + Q2148 (2)).
 *
 *   node src/test/pglite/salesTaxAdjustments.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/salesTaxAdjustments.pglite.mjs # RED: without it
 *
 * The ledger of corrections to Stripe's Tax report: only the service role
 * writes it, nobody else reads the table, one dedupe ref is one row, a row can
 * only lower the tax, and the admin export leaves out TEST and seed rows.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FIX = readMigration("20261105021744_sales_tax_adjustments.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no ledger (expect FAILs)`);
const { P, X } = USERS;
const ADMIN = "66666666-6666-6666-6666-666666666666";
const { check, failures } = checker();

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
// seriesWorld's has_role knows no admins; this proof needs one.
await db.exec(`
  create table if not exists public.proof_admins (user_id uuid primary key);
  insert into public.proof_admins values ('${ADMIN}');
  create or replace function public.has_role(uuid, public.app_role) returns boolean language sql stable as $f$
    select $2::text = 'admin' and exists (select 1 from public.proof_admins where user_id = $1) $f$;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

const row = (ref, extra = "") => `insert into public.sales_tax_adjustments
  (kind, flow, stripe_payment_intent_id, dedupe_ref, tax_reported_cents, tax_collected_cents, state_code, postal_code, livemode, is_seed, occurred_at${extra ? ", " + extra.split("=")[0] : ""})
  values ('dispute_lost', 'job', 'pi_${ref}', 'dispute:du_${ref}', 900, 0, 'LA', '70501', true, false, '2026-11-04T12:00Z'${extra ? ", " + extra.split("=")[1] : ""})`;

let r = await as(db, "service_role", null, row("live1"));
check("the service role records a lost-dispute correction", r.ok, r.err);
r = await as(db, "service_role", null, row("live1") + " on conflict (dedupe_ref) do nothing");
check("a webhook retry with the same dedupe ref adds nothing", r.ok && r.affected === 0, r.err ?? String(r.affected));
r = await as(db, "service_role", null, row("live1"));
check("a second row for one dedupe ref is refused", refused(r, /duplicate key|unique/), r.err);
const adj = (await db.query(`select adjustment_cents from public.sales_tax_adjustments where dedupe_ref='dispute:du_live1'`)).rows[0]?.adjustment_cents;
check("the adjustment is what we kept minus what Stripe reports (-900)", adj === -900, String(adj));

r = await as(db, "service_role", null, `insert into public.sales_tax_adjustments
  (kind, flow, stripe_payment_intent_id, dedupe_ref, tax_reported_cents, tax_collected_cents, livemode, occurred_at)
  values ('partial_capture', 'job', 'pi_up', 'capture:pi_up', 100, 200, true, now())`);
check("a row can never ADD tax (collected above reported is refused)", refused(r, /never_adds|check/), r.err);
r = await as(db, "service_role", null, `insert into public.sales_tax_adjustments
  (kind, flow, stripe_payment_intent_id, dedupe_ref, tax_reported_cents, tax_collected_cents, livemode, occurred_at)
  values ('refund', 'job', 'pi_k', 'refund:k', 100, 0, true, now())`);
check("an unknown kind is refused", refused(r, /check/), r.err);

// TEST-mode and seed rows exist but never reach the export.
await as(db, "service_role", null, `insert into public.sales_tax_adjustments
  (kind, flow, stripe_payment_intent_id, dedupe_ref, tax_reported_cents, tax_collected_cents, livemode, is_seed, occurred_at) values
  ('partial_capture', 'job', 'pi_test', 'capture:pi_test', 900, 270, false, false, '2026-11-04T13:00Z'),
  ('partial_capture', 'job', 'pi_seed', 'capture:pi_seed', 900, 270, true, true, '2026-11-04T13:00Z'),
  ('partial_capture', 'shop_order', 'pi_live2', 'capture:pi_live2', 900, 270, true, false, '2026-11-04T14:00Z'),
  ('dispute_lost', 'job', 'pi_late', 'dispute:du_late', 500, 0, true, false, '2026-12-01T00:00Z')`);

for (const [who, uid] of [["anon", null], ["a member", P], ["a stranger", X], ["an admin", ADMIN]]) {
  const role = uid ? "authenticated" : "anon";
  r = await as(db, role, uid, `select count(*)::int as n from public.sales_tax_adjustments`);
  check(`${who} cannot read the table directly`, refused(r, /permission denied/), r.err ?? JSON.stringify(r.rows));
  r = await as(db, role, uid, `insert into public.sales_tax_adjustments (kind, flow, stripe_payment_intent_id, dedupe_ref, tax_reported_cents, tax_collected_cents, livemode, occurred_at) values ('dispute_lost','job','pi_x','dispute:x',1,0,true,now())`);
  check(`${who} cannot write the table`, refused(r, /permission denied/), r.err);
}
for (const [who, uid] of [["anon", null], ["a member", P]]) {
  r = await as(db, uid ? "authenticated" : "anon", uid, `select * from public.admin_sales_tax_adjustments('2026-11-01T00:00Z', '2026-12-01T00:00Z')`);
  check(`${who} cannot run the export`, refused(r, /admin only|permission denied/), r.err);
}
r = await as(db, "authenticated", ADMIN, `select * from public.admin_sales_tax_adjustments('2026-11-01T00:00Z', '2026-12-01T00:00Z')`);
const refs = (r.rows ?? []).map((x) => x.stripe_payment_intent_id).join(",");
check("the admin export lists the two live, non-seed November rows in time order", r.ok && refs === "pi_live1,pi_live2", r.err ?? refs);
check("the export carries the adjustment", r.ok && r.rows[1]?.adjustment_cents === -630, JSON.stringify(r.rows?.[1]));
check("the export leaves out TEST (livemode false) and seed rows", r.ok && !/pi_test|pi_seed/.test(refs), refs);
check("the period end is exclusive (a Dec 1 row is not November)", r.ok && !/pi_late/.test(refs), refs);
r = await as(db, "authenticated", ADMIN, `select * from public.admin_sales_tax_adjustments('2026-12-01', '2026-11-01')`);
check("a backwards period is refused", refused(r, /bad period/), r.err);
const acl = (await db.query(`select proacl::text as a from pg_proc where proname='admin_sales_tax_adjustments'`)).rows[0]?.a ?? "";
check("the export function grants nothing to PUBLIC or anon", acl !== "" && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl), acl);

if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL PASS");
