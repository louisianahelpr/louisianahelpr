#!/usr/bin/env node
/**
 * PGlite proof for 20261102065446_declutter_fee_debt_waiver (Q1928 gap 1): an admin clears what a member still owes
 * from a Declutter refund (a ban or flag overturned), with a reason; the payout path then takes nothing more.
 *
 *   node src/test/pglite/declutterFeeDebtWaiver.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFeeDebtWaiver.pglite.mjs  # RED: no waiver
 *   MUTANT=<name> node src/test/pglite/declutterFeeDebtWaiver.pglite.mjs       # a planted defect: must FAIL
 *
 * Real: the migration's text verbatim (3x), declutter_consume_fee_debt at its newest definition. Stubbed, said so: the
 * tables reduced to the columns read; has_role reads a test table; auth.uid reads a setting; declutter_notify records
 * calls; declutter_order_items_named is a fixed name. Supabase's default anon/authenticated EXECUTE grant is emulated
 * (ALTER DEFAULT PRIVILEGES), so a missing REVOKE shows. pglite is not a dependency (CLAUDE.md): ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102065446_declutter_fee_debt_waiver.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Anyone signed in can clear a debt.
  noAdminCheck: ["  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN\n    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';\n  END IF;\n  IF char_length", "  IF char_length"],
  // The row is marked but the payout path still collects.
  keepsCollecting: ["     SET remaining_cents = 0, waived_at = now()", "     SET waived_at = now()"],
  // No audit row.
  noAudit: ["  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)\n  VALUES (v_uid, 'declutter_admin_waive_fee_debt'", "  PERFORM (v_uid, 'declutter_admin_waive_fee_debt'"],
  // A second click writes (and tells the member) again.
  notOnce: ["  IF d.waived_at IS NOT NULL THEN", "  IF false THEN"],
  // Clears the whole original amount, not what is left.
  wholeAmount: ["waived_cents = d.remaining_cents, waive_note", "waived_cents = (SELECT amount_cents FROM public.declutter_seller_fee_debts WHERE id = d.id), waive_note"],
  // Left executable by anon (Supabase's default grant).
  openToAnon: ["REVOKE ALL ON FUNCTION public.declutter_admin_waive_fee_debt(uuid, text) FROM PUBLIC, anon;", ""],
  // No reason needed.
  noNote: ["  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN\n    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';\n  END IF;\n  SELECT x.seller_id", "  SELECT x.seller_id"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `cdcdcdcd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), SELLER = U(2), MEMBER = U(3), HELPR = U(4);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.admins (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT r = 'admin' AND EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = u) $$;
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reason text);
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL,
  refund_id uuid UNIQUE, raise_id uuid, shop_refund_id uuid, amount_cents integer NOT NULL, remaining_cents integer NOT NULL,
  fee_estimated boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents integer);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notices (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_message, p_link) $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'Oak chair' $$;
INSERT INTO public.admins VALUES ('${ADMIN}');
`);
await db.exec(definitionBefore("declutter_consume_fee_debt", "99999999"));
if (!skip) {
  let sql = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.split(find).join(repl);
  }
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
async function as(role, uid, sql, p = []) {
  try {
    await db.exec(`SET test.uid = '${uid ?? ""}'; SET ROLE ${role};`);
    return { rows: (await db.query(sql, p)).rows };
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET test.uid;`);
  }
}
const debt = async (seller, amount, remaining = amount, reason = "seller_out") => {
  const ref = (await q(`INSERT INTO public.declutter_refunds (order_id, reason) VALUES (gen_random_uuid(), $1) RETURNING id`, [reason]))[0].id;
  return (await q(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents) VALUES ($1, $2, $3, $4) RETURNING id`,
    [seller, ref, amount, remaining]))[0].id;
};
const row = async (id) => (await q(`SELECT * FROM public.declutter_seller_fee_debts WHERE id = $1`, [id]))[0];
const waive = (uid, id, note = "Ban overturned on appeal", role = "authenticated") =>
  as(role, uid, `SELECT public.declutter_admin_waive_fee_debt($1, $2) AS r`, [id, note]);
const audits = async (id) => (await q(`SELECT count(*)::int n FROM public.admin_audit_log WHERE target_id = $1::text`, [id]))[0].n;
const told = async (uid) => q(`SELECT title, message FROM public.notices WHERE user_id = $1 AND title = 'Amount owed cleared'`, [uid]);

const d1 = await debt(SELLER, 163);
const d2 = await debt(SELLER, 200, 50);   // a payout already took 150
const d3 = await debt(SELLER, 90, 0);     // paid back in full
const d4 = await debt(HELPR, 120, 120, "helpr_fault");

// Who may call.
const anonList = await as("anon", null, `SELECT * FROM public.declutter_admin_fee_debts($1)`, [SELLER]);
const anonWaive = await waive(null, d1, "x", "anon");
check(/permission denied/.test(anonList.error ?? "") && /permission denied/.test(anonWaive.error ?? ""),
  "anon cannot run either function (permission denied, not only admin_only)", JSON.stringify([anonList, anonWaive]));
const grants = (await q(`SELECT has_function_privilege('anon', 'public.declutter_admin_waive_fee_debt(uuid, text)', 'EXECUTE') AS w,
  has_function_privilege('anon', 'public.declutter_admin_fee_debts(uuid)', 'EXECUTE') AS l,
  has_function_privilege('authenticated', 'public.declutter_admin_waive_fee_debt(uuid, text)', 'EXECUTE') AS aw`).catch(() => [{}]))[0];
check(grants.w === false && grants.l === false && grants.aw === true, "grants: anon has no EXECUTE on either; authenticated (admin checked inside) has", JSON.stringify(grants));
const memList = await as("authenticated", MEMBER, `SELECT * FROM public.declutter_admin_fee_debts($1)`, [SELLER]);
const memWaive = await waive(MEMBER, d1);
const selfWaive = await waive(SELLER, d1);
check(/admin_only/.test(memList.error ?? "") && /admin_only/.test(memWaive.error ?? "") && /admin_only/.test(selfWaive.error ?? ""),
  "a member (the seller included) is refused: admin_only", JSON.stringify([memList.error, memWaive.error, selfWaive.error]));
check((await row(d1))?.remaining_cents === 163, "a refused call changes nothing");

// The admin's list.
const list = await as("authenticated", ADMIN, `SELECT * FROM public.declutter_admin_fee_debts($1)`, [SELLER]);
check(list.rows?.length === 3 && list.rows.every((r) => r.items === "Oak chair" && r.reason === "seller_out"),
  "the admin lists the member's amounts, with the item and the reason", JSON.stringify(list));

// A reason is required.
const noNote = await waive(ADMIN, d1, "   ");
check(/invalid_note/.test(noNote.error ?? "") && (await row(d1)).remaining_cents === 163, "no reason: refused (invalid_note), nothing changed", JSON.stringify(noNote));

// Clear d1.
const w1 = await waive(ADMIN, d1);
const r1 = await row(d1);
check(w1.rows?.[0]?.r?.result === "waived" && w1.rows[0].r.waived_cents === 163, "the admin clears it: waived, 163 cents", JSON.stringify(w1));
check(r1?.remaining_cents === 0 && r1.waived_by === ADMIN && r1.waived_cents === 163 && r1.waive_note === "Ban overturned on appeal" && r1.waived_at,
  "the row says nothing is owed, who cleared it, how much and why", JSON.stringify(r1));
check(await audits(d1) === 1, "one admin_audit_log row");
const t1 = await told(SELLER);
check(t1.length === 1 && t1[0].message.includes("$1.63") && !/fee/i.test(t1[0].title + t1[0].message),
  "the member is told once, with the amount, in words (no fee name)", JSON.stringify(t1));
const again = await waive(ADMIN, d1, "double click");
check(again.rows?.[0]?.r?.result === "already_waived" && await audits(d1) === 1 && (await told(SELLER)).length === 1 && (await row(d1)).waive_note === "Ban overturned on appeal",
  "a second click: the same answer, no second audit row, notice or note", JSON.stringify(again));

// Part paid back: only what is left is cleared; what was taken stays taken.
const w2 = await waive(ADMIN, d2);
const r2 = await row(d2);
check(w2.rows?.[0]?.r?.waived_cents === 50 && r2.remaining_cents === 0 && r2.waived_cents === 50 && r2.amount_cents === 200,
  "a part-paid amount: only the 50 cents left is cleared; the 150 taken is not given back", JSON.stringify(r2));
// Paid in full: nothing to clear.
const w3 = await waive(ADMIN, d3);
check(/nothing_owed/.test(w3.error ?? "") && !(await row(d3)).waived_at, "an amount already paid back: refused (nothing_owed)", JSON.stringify(w3));
// Unknown id.
const w5 = await waive(ADMIN, U(99));
check(/debt_not_found/.test(w5.error ?? ""), "an unknown amount: debt_not_found", JSON.stringify(w5));

// The payout path takes nothing more from cleared rows; a Helpr's own amount is untouched until cleared.
const took = (await q(`SELECT public.declutter_consume_fee_debt($1, 'declutter_order_after_waive', 5000) AS n`, [SELLER]))[0].n;
check(took === 0, "the seller's next payout takes nothing (every row cleared or paid)", String(took));
const w4 = await waive(ADMIN, d4, "Helpr fault overturned");
check(w4.rows?.[0]?.r?.waived_cents === 120 && (await q(`SELECT public.declutter_consume_fee_debt($1, 'helpr_task_x', 5000) AS n`, [HELPR]))[0].n === 0,
  "a Helpr's amount can be cleared the same way, and their next payout takes nothing", JSON.stringify(w4));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
