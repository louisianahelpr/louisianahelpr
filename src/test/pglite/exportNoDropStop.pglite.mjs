#!/usr/bin/env node
/**
 * PGlite proof for 20261021141852_export_my_data_no_drop_stop (Q2262, spec B42: the price-drop stop is private even
 * from the seller).
 *
 *   node src/test/pglite/exportNoDropStop.pglite.mjs              # all PASS
 *   MIGRATION_PATH=supabase/migrations/20261021041946_export_my_data_offer_counterparty.sql \
 *     node src/test/pglite/exportNoDropStop.pglite.mjs            # RED: N2 fails (the stop is exported)
 *
 * A1: the whole migration is applied 3x (plpgsql resolves tables only when it runs, so the CREATE needs no tables);
 * the function exists once and only service_role (and its owner) can execute it.
 * N1-N3 run the declutter_item_private section CUT VERBATIM from the migration's export body (balanced parentheses
 * from `jsonb_build_object('declutter_item_private'`), with v_uid bound to a member, over a table shaped as live
 * (declutter_item_private columns read from prod information_schema 2026-10-21). The whole body's caller scoping is
 * src/test/dataExportCoversEveryUserTable.test.ts.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261021141852_export_my_data_no_drop_stop.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

/** The `(SELECT ...)` argument of jsonb_build_object('<name>', ...) in the migration's export body, verbatim. */
function section(name) {
  const head = `jsonb_build_object('${name}',`;
  const at = SQL.indexOf(head);
  if (at < 0) return null;
  let i = at + head.length;
  while (SQL[i] !== "(") i++;
  let depth = 0;
  for (let j = i; j < SQL.length; j++) {
    if (SQL[j] === "(") depth++;
    else if (SQL[j] === ")" && --depth === 0) return SQL.slice(i, j + 1);
  }
  return null;
}

const SELLER = "11111111-0000-4000-8000-000000000001";
const OTHER = "22222222-0000-4000-8000-000000000002";
const db = new PGlite();
// seed-policy: not prod (throwaway PGlite only)
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, seller_id uuid NOT NULL, floor_price_cents integer,
    pickup_address text, pickup_lat numeric, pickup_lng numeric, updated_at timestamptz DEFAULT now(), ai_checked_at timestamptz,
    ai_flag_reason text, review_note text, drop_stop_cents integer, move_out_on date, drops_stopped boolean, sale_name text,
    sale_starts_on date);
  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, ai_flag_reason, drop_stop_cents) VALUES
    (gen_random_uuid(), '${SELLER}', 2000, '1 Main St', 'looked like a weapon', 2100),
    (gen_random_uuid(), '${OTHER}', 900, '2 Oak St', NULL, 950);`);

// A1: applied 3x, one function, service_role only.
let applyErr = null;
for (let n = 0; n < 3 && !applyErr; n++) {
  try { await db.exec(SQL); } catch (e) { applyErr = String(e.message ?? e); }
}
ok(applyErr === null, `[replay] A1: the migration applies 3x (${applyErr ?? "ok"})`);
const fns = (await db.query(`SELECT p.oid::regprocedure::text AS sig,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
  FROM pg_proc p WHERE p.proname = 'export_my_data'`)).rows;
ok(fns.length === 1 && fns[0].sig === "export_my_data(uuid)", `[replay] A2: exactly one export_my_data(uuid) (${fns.map((f) => f.sig).join(", ")})`);
ok(fns[0] && !fns[0].auth_x && !fns[0].anon_x && fns[0].svc_x, "[grants] A3: authenticated and anon cannot execute it; service_role can");

const expr = section("declutter_item_private");
let rows = null;
let err = null;
try {
  rows = (await db.query(`SELECT ${expr.replace(/\bv_uid\b/g, `'${SELLER}'::uuid`)} AS v`)).rows[0].v;
} catch (e) { err = String(e.message ?? e); }
ok(Array.isArray(rows) && rows.length === 1, `[keep] N1: the seller's export has their one private row (${err ?? rows?.length})`);
ok(rows?.[0] && !("drop_stop_cents" in rows[0]), `[fix] N2: no drop_stop_cents in it (B42) (keys: ${rows?.[0] ? Object.keys(rows[0]).join(",") : "-"})`);
ok(rows?.[0] && !("ai_flag_reason" in rows[0]) && rows[0].floor_price_cents === 2000 && rows[0].pickup_address === "1 Main St",
  "[keep] N3: ai_flag_reason still removed; the seller's own floor and pickup address still exported");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
