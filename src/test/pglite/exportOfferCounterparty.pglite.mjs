#!/usr/bin/env node
/**
 * PGlite proof for 20261021041946_export_my_data_offer_counterparty (Q2274, Q2278, and the payout_failures section
 * kept from 20261021035753).
 *
 *   node src/test/pglite/exportOfferCounterparty.pglite.mjs                       # all PASS
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/exportOfferCounterparty.pglite.mjs
 *
 * export_my_data reads well over a hundred tables this harness does not build (see homesSavedHomes.pglite.mjs), so
 * this runs the three sections the migration changes or must keep, CUT VERBATIM from the migration's newest
 * export_my_data body (balanced parentheses from `jsonb_build_object('<section>'`), with v_uid bound to a member,
 * over tables shaped as live (declutter_offers' six statuses = prod's declutter_offers_status_check, measured
 * 2026-10-21). The whole body's caller scoping is src/test/dataExportCoversEveryUserTable.test.ts (newest body,
 * every user table, both ways); the two sections' wording is src/test/exportHidesUnsoldOfferBuyer.test.ts.
 * Applying the migration itself 3x needs that whole world too, so replay-safety is shown on the statement shape
 * instead: DROP FUNCTION IF EXISTS + CREATE OR REPLACE + REVOKE/GRANT, nothing else (check E0).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261021041946_export_my_data_offer_counterparty.sql";
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

// E0: the statements are the replay-safe kinds only.
// Function bodies (any dollar tag) are blanked first, so a `;` inside one does not split a statement.
const code = SQL.replace(/--[^\n]*/g, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$body$$");
const stmts = code.split(";").map((s) => s.trim()).filter(Boolean);
const kinds = new Set(stmts.map((s) => (/^(DROP FUNCTION IF EXISTS|CREATE OR REPLACE FUNCTION|REVOKE|GRANT)/i.exec(s) ?? ["OTHER"])[0].toUpperCase()));
ok(![...kinds].includes("OTHER"), `[fix] E0: only DROP FUNCTION IF EXISTS / CREATE OR REPLACE / REVOKE / GRANT (got ${[...kinds].join(", ")})`);

const SELLER = "11111111-0000-4000-8000-000000000001";
const BUYER = "22222222-0000-4000-8000-000000000002";
const ASKER = "33333333-0000-4000-8000-000000000003";
const ITEM = "aaaaaaaa-0000-4000-8000-000000000001";
const db = new PGlite();
// seed-policy: not prod (throwaway PGlite only)
await db.exec(`
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    amount_cents int, status text CHECK (status IN ('open', 'accepted', 'declined', 'expired', 'withdrawn', 'voided')), wanted_id uuid);
  CREATE TABLE public.declutter_questions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, asker_id uuid, question text, answer text);
  CREATE TABLE public.payout_failures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, amount_cents int);
  INSERT INTO public.declutter_items VALUES ('${ITEM}', '${SELLER}');
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, status)
    SELECT '${ITEM}', '${BUYER}', '${SELLER}', 1000, s FROM unnest(ARRAY['open', 'accepted', 'declined', 'expired', 'withdrawn', 'voided']) s;
  INSERT INTO public.declutter_questions (item_id, asker_id, question) VALUES ('${ITEM}', '${ASKER}', 'Still there?'), ('${ITEM}', '${SELLER}', 'Seller note');
  INSERT INTO public.payout_failures (user_id, amount_cents) VALUES ('${SELLER}', 500), ('${BUYER}', 700);`);

async function run(name, uid) {
  const expr = section(name);
  if (!expr) return { missing: true };
  try {
    const r = await db.query(`SELECT ${expr.replace(/\bv_uid\b/g, `'${uid}'::uuid`)} AS v`);
    return { rows: r.rows[0].v };
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
}

// --- Q2274: the seller's copy never names the buyer of an offer not taken into a cart
const sel = await run("declutter_offers", SELLER);
ok(Array.isArray(sel.rows) && sel.rows.length === 6, `[fix] E1: the seller's export has all six offers (${sel.error ?? sel.rows?.length ?? "section missing"})`);
const named = (sel.rows ?? []).filter((o) => "buyer_id" in o).map((o) => o.status);
ok(named.join() === "accepted", `[fix] E2: buyer_id only on the accepted one (named on: ${named.join() || "none"})`);
const buy = await run("declutter_offers", BUYER);
ok(Array.isArray(buy.rows) && buy.rows.length === 6 && buy.rows.every((o) => o.buyer_id === BUYER && o.seller_id === SELLER),
  "[fix] E3: the buyer's own copy is unchanged (both ids on every row)");

// --- Q2278: questions on the caller's items asked by someone else drop asker_id; the asker's own keep it
const qs = await run("declutter_questions", SELLER);
const other = (qs.rows ?? []).find((q) => q.question === "Still there?");
const own = (qs.rows ?? []).find((q) => q.question === "Seller note");
ok(other && !("asker_id" in other), "[fix] E4: the seller's export does not say who asked a question on their item");
ok(own && own.asker_id === SELLER, "[fix] E5: a question the caller asked keeps its asker_id");
const asker = await run("declutter_questions", ASKER);
ok(Array.isArray(asker.rows) && asker.rows.length === 1 && asker.rows[0].asker_id === ASKER, "[fix] E6: the asker's export carries their own question with asker_id");

// --- payout_failures (20261021035753) is kept
const pf = await run("payout_failures", SELLER);
ok(Array.isArray(pf.rows) && pf.rows.length === 1 && pf.rows[0].amount_cents === 500, `[fix] E7: payout_failures is still exported, the member's own row only (${pf.error ?? (pf.missing ? "section missing" : pf.rows.length)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
