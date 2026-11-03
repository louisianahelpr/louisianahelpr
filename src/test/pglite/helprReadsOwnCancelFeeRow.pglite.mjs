#!/usr/bin/env node
/**
 * PGlite proof for 20261103021753_helpr_reads_own_cancel_fee_row.sql (Q1916): a signed-in Helpr reads their own
 * cancellation_fee_transfers row, six columns of it, and nothing else; the poster, a stranger and anon read nothing;
 * no client role writes.
 *
 *   node src/test/pglite/helprReadsOwnCancelFeeRow.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/helprReadsOwnCancelFeeRow.pglite.mjs  # RED (prod today: no client read)
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: the REAL ledger migration 20261002052502 (table, constraints, RLS on, every client role revoked) plus
 * failed_transfer_ids (20261023151810) and failure_reason, as prod has them (information_schema, 2026-11-02); then
 * this migration 3x. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261103021753_helpr_reads_own_cancel_fee_row.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid);
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;`);
// The ledger statements of 20261002052502 verbatim (table to service_role grant), less its unconfirmed-email gate
// call (prod holds no policy on this table: pg_policies, 2026-11-02) and its export_my_data restatement.
{
  const ledger = readFileSync(`${MIG_DIR}20261002052502_cancellation_fee_transfers_ledger.sql`, "utf8");
  const from = ledger.indexOf("CREATE TABLE IF NOT EXISTS public.cancellation_fee_transfers (");
  const toMarker = "GRANT ALL ON TABLE public.cancellation_fee_transfers TO service_role;";
  const to = ledger.indexOf(toMarker) + toMarker.length;
  if (from < 0 || to < toMarker.length) throw new Error("20261002052502: ledger statements not found");
  await db.exec(ledger.slice(from, to).replace("SELECT public.attach_unconfirmed_email_gate();", ""));
}
await db.exec(`
ALTER TABLE public.cancellation_fee_transfers ADD COLUMN IF NOT EXISTS failed_transfer_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.cancellation_fee_transfers ADD COLUMN IF NOT EXISTS failure_reason text;
GRANT ALL ON public.cancellation_fee_transfers TO service_role;`);
const prodCols = "id,job_id,helper_id,fee_amount,commission_percent,platform_cut,helper_amount,status,stripe_transfer_id,failure_reason,created_at,updated_at,paid_at,failed_transfer_ids";
const cols = (await db.query(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cancellation_fee_transfers'`)).rows[0].c;
ok(cols.split(",").sort().join() === prodCols.split(",").sort().join(), "the ledger has prod's 14 columns", cols);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}

const POSTER = "00000000-0000-0000-0000-0000000000aa";
const HELPR = "00000000-0000-0000-0000-0000000000bb";
const OTHER_HELPR = "00000000-0000-0000-0000-0000000000cc";
const JOB = "00000000-0000-0000-0000-0000000000d1";
const JOB2 = "00000000-0000-0000-0000-0000000000d2";
await db.exec(`
INSERT INTO auth.users VALUES ('${POSTER}'), ('${HELPR}'), ('${OTHER_HELPR}');
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}'), ('${JOB2}', '${POSTER}');
INSERT INTO public.cancellation_fee_transfers (job_id, helper_id, fee_amount, commission_percent, platform_cut, helper_amount, status, failure_reason)
  VALUES ('${JOB}', '${HELPR}', 150, 12, 18, 132, 'pending', 'payee_not_payable: rejected'),
         ('${JOB2}', '${OTHER_HELPR}', 100, 12, 12, 88, 'pending', NULL);
UPDATE public.cancellation_fee_transfers SET status = 'paid', stripe_transfer_id = 'tr_other', paid_at = now() WHERE helper_id = '${OTHER_HELPR}';`);

const as = async (role, uid, sql) => {
  await db.exec(`${uid ? `SET test.uid = '${uid}';` : ""} SET ROLE ${role};`);
  try {
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("RESET ROLE; RESET test.uid;");
  }
};
const SIX = "id, job_id, helper_id, helper_amount, status, paid_at";

// 1. The Helpr reads their own row: six columns, the true status and amount.
const own = await as("authenticated", HELPR, `SELECT ${SIX} FROM public.cancellation_fee_transfers`);
ok(own.rows?.length === 1 && own.rows[0].job_id === JOB && own.rows[0].status === "pending" && Number(own.rows[0].helper_amount) === 132,
  "the Helpr reads their own row (status pending, $132 to them)", JSON.stringify(own));
const filtered = await as("authenticated", HELPR, `SELECT status FROM public.cancellation_fee_transfers WHERE job_id = '${JOB}' AND helper_id = '${HELPR}'`);
ok(filtered.rows?.length === 1, "  the card's read (by job and Helpr) works", JSON.stringify(filtered));
const notTheirs = await as("authenticated", HELPR, `SELECT ${SIX} FROM public.cancellation_fee_transfers WHERE job_id = '${JOB2}'`);
ok(notTheirs.rows?.length === 0, "  never another Helpr's row", JSON.stringify(notTheirs));

// 2. Every other column stays hidden, even on their own row.
for (const c of ["fee_amount", "commission_percent", "platform_cut", "stripe_transfer_id", "failure_reason", "failed_transfer_ids", "created_at", "updated_at"]) {
  const r = await as("authenticated", HELPR, `SELECT ${c} FROM public.cancellation_fee_transfers`);
  ok(/permission denied/i.test(r.error ?? ""), `  ${c} is not readable`, JSON.stringify(r));
}
const star = await as("authenticated", HELPR, `SELECT * FROM public.cancellation_fee_transfers`);
ok(/permission denied/i.test(star.error ?? ""), "  SELECT * is refused (no table-wide grant)", JSON.stringify(star));

// 3. The poster, another Helpr (on this job) and anon read nothing of it.
const poster = await as("authenticated", POSTER, `SELECT ${SIX} FROM public.cancellation_fee_transfers`);
ok(poster.rows?.length === 0, "the poster reads no fee row", JSON.stringify(poster));
const other = await as("authenticated", OTHER_HELPR, `SELECT ${SIX} FROM public.cancellation_fee_transfers WHERE job_id = '${JOB}'`);
ok(other.rows?.length === 0, "another member reads nothing of this Helpr's row", JSON.stringify(other));
const anon = await as("anon", null, `SELECT id FROM public.cancellation_fee_transfers`);
ok(/permission denied/i.test(anon.error ?? ""), "anon reads nothing", JSON.stringify(anon));

// 4. No client writes.
for (const [label, sql] of [
  ["update", `UPDATE public.cancellation_fee_transfers SET status = 'paid' WHERE helper_id = '${HELPR}'`],
  ["insert", `INSERT INTO public.cancellation_fee_transfers (job_id, helper_id, fee_amount, commission_percent, platform_cut, helper_amount, status) VALUES ('${JOB2}', '${HELPR}', 1, 0, 0, 1, 'pending')`],
  ["delete", `DELETE FROM public.cancellation_fee_transfers WHERE helper_id = '${HELPR}'`],
]) {
  const r = await as("authenticated", HELPR, sql);
  ok(/permission denied/i.test(r.error ?? ""), `the Helpr cannot ${label} a fee row`, JSON.stringify(r));
}

// 5. Exactly one client policy, SELECT only, to authenticated.
const pols = (await db.query(`SELECT policyname, cmd, roles::text r FROM pg_policies WHERE tablename = 'cancellation_fee_transfers'`)).rows;
ok(pols.length === 1 && pols[0].cmd === "SELECT" && pols[0].r === "{authenticated}", "one policy: SELECT, authenticated", JSON.stringify(pols));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
