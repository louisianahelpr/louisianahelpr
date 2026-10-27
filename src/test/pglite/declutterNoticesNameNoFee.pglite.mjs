#!/usr/bin/env node
/**
 * PGlite proof for 20261027172503_declutter_notices_name_no_fee (owner 2026-10-25,
 * re-confirmed for Declutter 2026-10-27, issue #3672: members never see a fee
 * name, number or maths).
 *
 *   node src/test/pglite/declutterNoticesNameNoFee.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticesNameNoFee.pglite.mjs     # RED: the unfixed copy
 *   BODIES_DIR=<dir> node src/test/pglite/declutterNoticesNameNoFee.pglite.mjs       # prod-shaped: <dir>/<fn>.sql
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Loads each rewritten function from the migration that last defines it (the
 * definitions effectiveDefs resolves to on this branch; no earlier rewrite
 * migration touches these functions), or, with BODIES_DIR, from
 * pg_get_functiondef() text saved from prod. check_function_bodies is off, so
 * the bodies need none of their tables. Applies the migration 3x through the
 * real pg_get_functiondef + regexp_replace + EXECUTE path and reads prosrc:
 *   - no member notice literal of these functions names a fee (staff text,
 *     an admin alert or RAISE an admin reads, is excluded by literal);
 *   - every function changed, and a second and third apply change nothing;
 *   - with every string literal blanked, each body is byte-for-byte the same
 *     before and after: only the words changed, never the logic, a placeholder
 *     count, an argument or a money figure;
 *   - each literal that changed keeps its %s placeholders.
 */
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261027172503_declutter_notices_name_no_fee.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const BODIES = process.env.BODIES_DIR ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the unfixed state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** Each function -> the migration that last defines it (effectiveDefs, measured 2026-10-27 on this branch). */
const SOURCES = {
  declutter_close_paid_order: "20261027170717_declutter_free_section.sql",
  declutter_refund_paid_order: "20261014224914_declutter_slice3b_payments.sql",
  declutter_report_no_show: "20261015042253_declutter_slice4_handover_payout.sql",
  declutter_handover_sweep: "20261027153244_declutter_seller_delivery.sql",
  declutter_complete_handover: "20261027170717_declutter_free_section.sql",
  declutter_delivery_on_task_event: "20261018184535_declutter_delivery_no_dropoff_code.sql",
  declutter_delivery_raise_paid: "20261021185418_declutter_delivery_raise_pay.sql",
  declutter_delivery_raises_on_task_close: "20261021185418_declutter_delivery_raise_pay.sql",
  declutter_seller_out_fee_notice: "20261017060455_declutter_seller_out_pays_fee.sql",
  declutter_setup_job_fee_debt: "20261017073146_declutter_add_a_helpr.sql",
  declutter_apply_seller_fault: "20261017073146_declutter_add_a_helpr.sql",
  declutter_refund_after_handover: "20261027153244_declutter_seller_delivery.sql",
  declutter_report_not_delivered: "20261027153244_declutter_seller_delivery.sql",
  declutter_seller_cancel_delivery: "20261027153244_declutter_seller_delivery.sql",
};
const FNS = Object.keys(SOURCES);

/** The LAST `CREATE [OR REPLACE] FUNCTION public.<fn>(` statement in `sql`, through its closing dollar tag. */
function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let stmt = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    if (!tag) continue;
    const open = tag.index + tag[0].length;
    const close = rest.indexOf(tag[1], open) + tag[1].length;
    const tail = rest.slice(close).match(/^[^;]*;/);
    stmt = rest.slice(0, close) + (tail ? tail[0] : ";");
  }
  return stmt;
}

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
SET check_function_bodies = off;
`);
const loaded = [];
for (const fn of FNS) {
  const file = BODIES ? `${BODIES}/${fn}.sql` : null;
  if (file && !existsSync(file)) { console.log(`SKIP  ${fn}: no prod body in ${BODIES} (not on prod yet)`); continue; }
  const stmt = file ? `${readFileSync(file, "utf8").trim().replace(/;?\s*$/, "")};` : lastDefinition(mig(SOURCES[fn]), fn);
  if (!stmt) { check(`${fn} is defined in ${SOURCES[fn]}`, false); continue; }
  try {
    await db.exec(`SET check_function_bodies = off; ${stmt}`);
    loaded.push(fn);
  } catch (e) {
    check(`${fn} loads`, false, String(e.message ?? e).slice(0, 200));
  }
}

const bodies = async () => Object.fromEntries(
  (await db.query(`SELECT proname, prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'`)).rows.map((r) => [r.proname, r.prosrc]));
const before = await bodies();
// With BODIES_DIR (prod), a function a not-yet-deployed migration adds is skipped above.
check(`${loaded.length} functions loaded`, loaded.length >= (BODIES ? 11 : FNS.length) && loaded.every((f) => before[f]), loaded.length);

if (!MODE) await db.exec(`SET check_function_bodies = off; ${NEW}`);
const once = await bodies();
if (!MODE) {
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
}
const after = await bodies();

// The class guard's fee words (src/test/membersSeeNoFeeWords.test.ts FEE_WORDS), in SQL's doubled-quote form.
const FEE = /platform fees?|service fees?|helpr'?s? fees?|buyer(?:''|')?s? fees?|seller(?:''|')?s? fees?|delivery[- ]fees?|processing fees?|card fees?|card-processing|card processing|%\s*\+\s*\$|cancellation fees?|commission/i;
// Staff text a member never reads: the ops alerts that name the card fee.
const STAFF = [/settle it by hand \(no fee, card fee to the seller\)/, /could not be billed \(the platform absorbs it\)/, /the raise card fee is not booked/];
/**
 * Split a plpgsql body into code and string literals: `--` and block comments are
 * dropped (a comment's apostrophe is not a quote), each '...' literal (doubled
 * quotes inside) is collected and replaced by ''.
 */
function tokens(src) {
  const s = src ?? "";
  let code = "";
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s.startsWith("--", i)) { const e = s.indexOf("\n", i); i = e < 0 ? s.length : e; continue; }
    if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (s[i] === "'") {
      let j = i + 1;
      for (; j < s.length; j++) { if (s[j] === "'") { if (s[j + 1] === "'") j++; else break; } }
      out.push(s.slice(i, j + 1));
      code += "''";
      i = j + 1;
      continue;
    }
    code += s[i++];
  }
  return { code, lits: out };
}
const lits = (src) => tokens(src).lits;
const blankLits = (src) => tokens(src).code;
for (const fn of loaded) {
  const bad = lits(after[fn]).filter((l) => FEE.test(l) && !STAFF.some((s) => s.test(l)));
  check(`${fn}: no member notice names a fee`, bad.length === 0, bad.map((b) => b.slice(0, 90)).join(" | "));
  check(`${fn}: changed`, MODE ? true : after[fn] !== before[fn]);
  check(`${fn}: with literals blanked the body is identical (only words changed)`, blankLits(after[fn]) === blankLits(before[fn]));
  const a = lits(before[fn]), b = lits(after[fn]);
  const placeholdersKept = a.length === b.length && a.every((l, i) => (l.match(/%s/g) ?? []).length === (b[i].match(/%s/g) ?? []).length);
  check(`${fn}: same literal count, each keeps its %s placeholders`, placeholdersKept, `${a.length} -> ${b.length}`);
}
check("applying it again changes nothing (replay-safe)", JSON.stringify(once) === JSON.stringify(after));

// A function the database does not have is skipped with a WARNING, never an error (replay on a fresh rebuild).
const fresh = new PGlite();
let freshOk = true;
try { await fresh.exec(NEW); } catch (e) { freshOk = false; console.log(String(e.message ?? e)); }
check("on a database without these functions the migration runs and changes nothing", freshOk);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
