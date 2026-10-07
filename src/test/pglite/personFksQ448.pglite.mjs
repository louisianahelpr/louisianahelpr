#!/usr/bin/env node
/**
 * PGlite proof for 20261007045539_person_fks_q448_named_columns (docs/OPEN.md
 * Q448): the eleven person columns named by role get a foreign key to
 * auth.users with the ON DELETE action the purge uses, the orphans already on
 * prod are cleaned the way the purge would have, and deleting an account then
 * removes or anonymises its rows on every path, purge or not.
 *
 *   node src/test/pglite/personFksQ448.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/personFksQ448.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Fixture: each table with the column as live (information_schema, nullability
 * measured 2026-10-07) and the orphan shapes measured that day.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261007045539_person_fks_q448_named_columns.sql", import.meta.url).pathname, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running against the state on main (expect FAILs)");

let fails = 0;
const check = (n, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`);
  if (!ok) fails++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offered_to_helper_id uuid,
  customer_id uuid, title text, direct_offer_status text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  title text NOT NULL, message text NOT NULL, type text, link text);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.helper_availability (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL);
CREATE TABLE public.user_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_id uuid NOT NULL);
CREATE TABLE public.recurring_visit_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payer_id uuid, helper_id uuid, amount_cents int);
CREATE TABLE public.job_tracking (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL);
CREATE TABLE public.helper_shadowbans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL);
CREATE TABLE public.crew_dispute_member_outcomes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid);
CREATE TABLE public.crew_confirm_pending (slot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL);
`);

const A = "aaaaaaaa-0000-4000-8000-00000000000a"; // a live account
const B = "bbbbbbbb-0000-4000-8000-00000000000b"; // a live account, deleted later
const GONE = "dddddddd-0000-4000-8000-00000000000d"; // already gone: an orphan
await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [A, B]);
// Orphans as measured on prod 2026-10-07, plus rows for the live accounts.
await db.exec(`
INSERT INTO public.helper_availability (helper_id) VALUES ('${GONE}'), ('${A}'), ('${B}');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${A}', '${GONE}'), ('${A}', '${B}');
INSERT INTO public.reports (reporter_id, reported_id) VALUES ('${GONE}', '${A}'), ('${B}', '${A}');
INSERT INTO public.jobs (offered_to_helper_id, customer_id, title, direct_offer_status)
  VALUES ('${B}', '${A}', 'Fence fix', 'pending'), ('${A}', '${B}', 'Lawn', 'pending');
-- An answered offer to B: its status is history and stays.
INSERT INTO public.jobs (offered_to_helper_id, customer_id, title, direct_offer_status) VALUES ('${B}', '${A}', 'Old', 'declined');
INSERT INTO public.group_job_helpers (helper_id) VALUES ('${B}');
INSERT INTO public.recurring_visit_payments (payer_id, helper_id, amount_cents) VALUES ('${B}', '${A}', 5000);
INSERT INTO public.job_tracking (helper_id) VALUES ('${B}');
INSERT INTO public.helper_shadowbans (helper_id) VALUES ('${B}');
INSERT INTO public.crew_dispute_member_outcomes (helper_id) VALUES ('${B}');
INSERT INTO public.crew_confirm_pending (job_id, helper_id) VALUES (gen_random_uuid(), '${B}');
`);

if (!skip) {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(MIG); } catch (e) { check(`migration applies (run ${i + 1})`, false, e.message); }
  }
}

const EXPECT = {
  "group_job_helpers.helper_id": "n",
  "helper_availability.helper_id": "c",
  "jobs.offered_to_helper_id": "n",
  "user_blocks.blocked_id": "c",
  "user_blocks.blocker_id": "c",
  "reports.reporter_id": "n",
  "recurring_visit_payments.payer_id": "n",
  "recurring_visit_payments.helper_id": "n",
  "job_tracking.helper_id": "c",
  "helper_shadowbans.helper_id": "c",
  "crew_dispute_member_outcomes.helper_id": "n",
  "crew_confirm_pending.helper_id": "c",
};
const fks = (await db.query(`
  SELECT c.conrelid::regclass::text || '.' || a.attname AS k, c.confdeltype AS d, c.convalidated AS v, c.confrelid::regclass::text AS ref
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f'`)).rows;
const byKey = Object.fromEntries(fks.map((r) => [r.k, r]));
for (const [k, d] of Object.entries(EXPECT)) {
  const r = byKey[k];
  check(`${k} has a validated FK to auth.users ON DELETE ${d === "c" ? "CASCADE" : "SET NULL"}`,
    !!r && r.d === d && r.v === true && r.ref === "auth.users", JSON.stringify(r ?? null));
}
check("each FK is added once however often the migration runs", fks.length === Object.keys(EXPECT).length, String(fks.length));

const n = async (sql) => (await db.query(sql)).rows[0].n;
check("an orphan availability row is deleted, as the purge would have",
  (await n(`SELECT count(*)::int n FROM public.helper_availability WHERE helper_id = '${GONE}'`)) === 0);
check("an orphan block row is deleted, as the purge would have",
  (await n(`SELECT count(*)::int n FROM public.user_blocks WHERE blocked_id = '${GONE}'`)) === 0);
check("an orphan reporter is anonymised and the report kept (4k)",
  (await n(`SELECT count(*)::int n FROM public.reports WHERE reporter_id IS NULL AND reported_id = '${A}'`)) === 1);
check("live accounts' rows are untouched by the cleanup",
  (await n(`SELECT count(*)::int n FROM public.helper_availability WHERE helper_id IN ('${A}', '${B}')`)) === 2);

// Delete account B on a path that skipped purge_user_data.
await db.query(`DELETE FROM auth.users WHERE id = $1`, [B]);
check("deleting an account deletes its availability", (await n(`SELECT count(*)::int n FROM public.helper_availability WHERE helper_id = '${B}'`)) === 0);
check("deleting an account deletes blocks naming it", (await n(`SELECT count(*)::int n FROM public.user_blocks WHERE blocked_id = '${B}'`)) === 0);
check("deleting an account deletes its location trail", (await n(`SELECT count(*)::int n FROM public.job_tracking`)) === 0);
check("deleting an account deletes its pending crew confirmation", (await n(`SELECT count(*)::int n FROM public.crew_confirm_pending`)) === 0);
check("deleting an account deletes its shadowban", (await n(`SELECT count(*)::int n FROM public.helper_shadowbans`)) === 0);
check("deleting an account keeps the report and anonymises its reporter",
  (await n(`SELECT count(*)::int n FROM public.reports WHERE reporter_id IS NOT NULL`)) === 0
  && (await n(`SELECT count(*)::int n FROM public.reports`)) === 2);
check("deleting an account keeps the crew roster slot, helper anonymised",
  (await n(`SELECT count(*)::int n FROM public.group_job_helpers WHERE helper_id IS NULL`)) === 1);
check("deleting an account clears a direct offer to it and keeps the job",
  (await n(`SELECT count(*)::int n FROM public.jobs WHERE offered_to_helper_id IS NULL`)) === 2
  && (await n(`SELECT count(*)::int n FROM public.jobs`)) === 3);
check("a pending direct offer to a deleted account is retired, not left pending with no target (review finding 3)",
  (await n(`SELECT count(*)::int n FROM public.jobs WHERE title = 'Fence fix' AND direct_offer_status = 'expired'`)) === 1);
check("an answered offer keeps its status", (await n(`SELECT count(*)::int n FROM public.jobs WHERE title = 'Old' AND direct_offer_status = 'declined'`)) === 1);
check("the poster is told the offer closed and the job is open to everyone",
  (await n(`SELECT count(*)::int n FROM public.notifications WHERE user_id = '${A}' AND title = 'Direct offer closed' AND message LIKE '%Fence fix%open to everyone%' AND link LIKE '/posts?job=%'`)) === 1);
check("an offer to a live account is untouched",
  (await n(`SELECT count(*)::int n FROM public.jobs WHERE title = 'Lawn' AND direct_offer_status = 'pending' AND offered_to_helper_id = '${A}'`)) === 1);
check("deleting an account keeps a visit payment (money history), payer anonymised, the other party kept",
  (await n(`SELECT count(*)::int n FROM public.recurring_visit_payments WHERE payer_id IS NULL AND helper_id = '${A}' AND amount_cents = 5000`)) === 1);
check("deleting an account keeps a crew dispute outcome, helper anonymised",
  (await n(`SELECT count(*)::int n FROM public.crew_dispute_member_outcomes WHERE helper_id IS NULL`)) === 1);

let err = null;
try { await db.query(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [A, GONE]); } catch (e) { err = e.message; }
check("a new row cannot name an account that does not exist", /foreign key/i.test(err ?? ""), err ?? "inserted");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
