#!/usr/bin/env node
/**
 * PGlite proof for 20261025203540_notices_never_name_the_helpr_fee.
 *
 *   node src/test/pglite/noticesNeverNameTheHelprFee.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/noticesNeverNameTheHelprFee.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Loads each rewritten function from the migration that last defines it (the
 * definitions effectiveDefs resolves to; none has a later rewrite), with
 * check_function_bodies off so the bodies need none of their tables. Applies
 * the migration 3x through the real pg_get_functiondef + regexp_replace +
 * EXECUTE path and reads prosrc:
 *   - no fee wording is left in any notice literal of these functions;
 *   - a second and third apply change nothing (replay-safe);
 *   - only lines carrying the reworded copy changed;
 *   - format() with the dropped percent placeholder still renders (format
 *     ignores the extra argument).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261025203540_notices_never_name_the_helpr_fee.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the unfixed state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SOURCES = {
  poster_cancel_job: "20261021130723_poster_cancel_checks_quoted_fee.sql",
  block_user_and_settle: "20261012124103_crew_block_slotless_share_by_hire_order.sql",
  settle_one_off_jobs_for_banned_account: "20261018050953_offer_notices_wait_for_funding.sql",
  series_release_dates: "20260927012806_recurring_split_days.sql",
  end_series_for_banned_account: "20260927012808_permanent_ban_ends_recurring_series.sql",
  end_recurring_series_by_platform: "20261014084428_platform_series_end_keeps_card_fee.sql",
  helper_cancel_booking: "20261006015121_crew_rest_carry_on.sql",
  sweep_unfilled_series_visit_reminders: "20261012195747_unfilled_series_visit_reminder.sql",
  bill_helpr_fault_card_fee: "20261019015301_helpr_fault_ruling.sql",
  rpc_answer_refund_request: "20261021102943_refund_requests.sql",
  cancel_job_after_failed_bank_payment: "20261017205845_failed_bank_payment_cancels_hired_job.sql",
};

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
for (const [fn, file] of Object.entries(SOURCES)) {
  const stmt = lastDefinition(mig(file), fn);
  if (!stmt) { check(`${fn} is defined in ${file}`, false); continue; }
  try {
    await db.exec(`SET check_function_bodies = off; ${stmt}`);
  } catch (e) {
    check(`${fn} loads`, false, String(e.message ?? e).slice(0, 200));
  }
}

const bodies = async () => Object.fromEntries(
  (await db.query(`SELECT proname, prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'`)).rows.map((r) => [r.proname, r.prosrc]));
const before = await bodies();
check(`all ${Object.keys(SOURCES).length} functions loaded`, Object.keys(SOURCES).every((f) => before[f]), Object.keys(before).length);

if (!MODE) await db.exec(`SET check_function_bodies = off; ${NEW}`);
const once = await bodies();
if (!MODE) {
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
}
const after = await bodies();

// Fee words a member may never read. Admin RAISE text (crew_fee_exceeds_budget)
// and the admin alert in block_user_and_settle are not member copy: excluded by literal.
const FEE = /cancellation fee|platform fee|card processing fee|card fee|minus platform|commission/i;
const ADMIN = [/crew_fee_exceeds_budget/, /Nothing was charged or paid automatically; settle it by hand/, /could not be billed: recover it by hand/];
for (const fn of Object.keys(SOURCES)) {
  const lits = (after[fn] ?? "").replace(/--[^\n]*/g, "").match(/'(?:[^']|'')*'/g) ?? [];
  const bad = lits.filter((l) => FEE.test(l) && !ADMIN.some((a) => a.test(l)));
  check(`${fn}: no notice names a fee`, bad.length === 0, bad.map((b) => b.slice(0, 80)).join(" | "));
  check(`${fn}: changed`, MODE ? true : after[fn] !== before[fn]);
}
check("applying it again changes nothing (replay-safe)", JSON.stringify(once) === JSON.stringify(after));

// Only the reworded lines differ.
for (const fn of Object.keys(SOURCES)) {
  const a = (before[fn] ?? "").split("\n");
  const b = (after[fn] ?? "").split("\n");
  const changed = a.filter((line, i) => line !== b[i]);
  const onlyCopy = a.length === b.length && changed.every((l) => FEE.test(l) || /Card fee added/.test(l));
  check(`${fn}: only copy lines changed (${changed.length})`, onlyCopy);
}

// format() ignores an extra argument: the crew and solo cancel notices keep their percent arg.
const f = (await db.query(`SELECT format('"%s" was cancelled. You''ll receive about $%s for the time you set aside.', 'Mow', '12.00', 25::numeric) AS m`)).rows[0].m;
check("format() renders with the dropped percent argument", f === `"Mow" was cancelled. You'll receive about $12.00 for the time you set aside.`, f);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
