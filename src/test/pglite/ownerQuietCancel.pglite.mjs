#!/usr/bin/env node
/**
 * PGlite proof for 20261023141407_owner_accounts_cancel_reads_as_another_helpr_selected.
 *
 *   node src/test/pglite/ownerQuietCancel.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/ownerQuietCancel.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the columns the migration touches (jobs.customer_id/helper_id, applications.job_id/
 * helper_id/status/closed_reason with main's closed_reason CHECK), and an AFTER UPDATE stand-in for
 * notify_on_application that records what it saw, so the proof shows the notifier still sees
 * 'job_cancelled' (and so never tells an unhired applicant anything) before the rewrite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261023141407_owner_accounts_cancel_reads_as_another_helpr_selected.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const OWNER_A = "7f65ef12-1d3d-439b-b0a7-f42ce8bc176d";
const OWNER_B = "76b07824-9b41-4741-a4c4-4f8de362f682";
const MEMBER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const H1 = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const H2 = "537de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY, job_id uuid REFERENCES public.jobs(id), helper_id uuid,
  status text NOT NULL DEFAULT 'pending', closed_reason text,
  CONSTRAINT applications_closed_reason_check CHECK (closed_reason IS NULL OR closed_reason = ANY (ARRAY['job_cancelled'::text, 'party_blocked'::text, 'offer_expired'::text, 'not_confirmed'::text]))
);
CREATE TABLE public.notify_seen (app_id uuid, old_status text, new_status text, reason text);
CREATE FUNCTION public.notify_stand_in() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.notify_seen VALUES (NEW.id, OLD.status, NEW.status, NEW.closed_reason);
  RETURN NULL;
END $f$;
CREATE TRIGGER notify_on_application AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_stand_in();
`);

// Rows already cancelled before the migration (the backfill's input).
await db.exec(`
INSERT INTO public.jobs (id, customer_id, helper_id) VALUES ('${id(1)}', '${OWNER_A}', NULL), ('${id(2)}', '${MEMBER}', NULL), ('${id(3)}', '${OWNER_B}', '${H1}');
INSERT INTO public.applications VALUES
  ('${id(11)}', '${id(1)}', '${H1}', 'rejected', 'job_cancelled'),
  ('${id(12)}', '${id(2)}', '${H1}', 'rejected', 'job_cancelled'),
  ('${id(13)}', '${id(3)}', '${H1}', 'accepted', 'job_cancelled'),
  ('${id(14)}', '${id(3)}', '${H2}', 'rejected', 'job_cancelled');
`);

if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(NEW); check(`migration applies (run ${i})`, true); }
    catch (e) { check(`migration applies (run ${i})`, false, e.message); }
  }
}

const reason = async (appId) => (await db.query(`SELECT closed_reason, status FROM public.applications WHERE id = $1`, [appId])).rows[0];

// Backfill.
check("backfill: owner A's cancelled job reads other_helpr_selected", (await reason(id(11))).closed_reason === "other_helpr_selected");
check("backfill: a member's cancelled job keeps job_cancelled", (await reason(id(12))).closed_reason === "job_cancelled");
check("backfill: owner B's HIRED Helpr keeps job_cancelled", (await reason(id(13))).closed_reason === "job_cancelled");
check("backfill: owner B's unhired applicant reads other_helpr_selected", (await reason(id(14))).closed_reason === "other_helpr_selected");

// Live cancels, written the way poster_cancel_job closes pending applications.
await db.exec(`
INSERT INTO public.jobs (id, customer_id, helper_id, offered_to_helper_id, direct_offer_status) VALUES
  ('${id(4)}', '${OWNER_A}', '${H1}', NULL, NULL), ('${id(5)}', '${MEMBER}', NULL, NULL, NULL),
  ('${id(6)}', '${OWNER_A}', NULL, '${H2}', 'pending'), ('${id(7)}', '${OWNER_A}', NULL, NULL, NULL);
INSERT INTO public.group_job_helpers VALUES ('${id(7)}', '${H1}');
INSERT INTO public.applications VALUES
  ('${id(21)}', '${id(4)}', '${H2}', 'pending', NULL),
  ('${id(22)}', '${id(4)}', '${H1}', 'accepted', NULL),
  ('${id(23)}', '${id(5)}', '${H2}', 'pending', NULL),
  ('${id(24)}', '${id(6)}', '${H2}', 'pending', NULL),
  ('${id(25)}', '${id(7)}', '${H1}', 'accepted', NULL),
  ('${id(26)}', '${id(7)}', '${H2}', 'pending', NULL);
DELETE FROM public.notify_seen;
UPDATE public.applications SET status = 'rejected', closed_reason = 'job_cancelled' WHERE id IN ('${id(21)}', '${id(23)}', '${id(24)}', '${id(26)}');
UPDATE public.applications SET closed_reason = 'job_cancelled' WHERE id = '${id(25)}';
UPDATE public.applications SET closed_reason = 'job_cancelled' WHERE id = '${id(22)}';
`);
const a21 = await reason(id(21));
check("cancel: owner's unhired applicant reads other_helpr_selected", a21.closed_reason === "other_helpr_selected", JSON.stringify(a21));
check("cancel: the applicant stays rejected (not pending, not accepted)", a21.status === "rejected");
check("cancel: owner's HIRED Helpr is still told job_cancelled", (await reason(id(22))).closed_reason === "job_cancelled");
check("cancel: a member's job is untouched", (await reason(id(23))).closed_reason === "job_cancelled");
check("cancel: a pending direct offer's recipient is still told job_cancelled", (await reason(id(24))).closed_reason === "job_cancelled");
check("cancel: a crew member on the roster is still told job_cancelled", (await reason(id(25))).closed_reason === "job_cancelled");
check("cancel: a crew job's unhired applicant reads other_helpr_selected", (await reason(id(26))).closed_reason === "other_helpr_selected");

const seen = (await db.query(`SELECT old_status, new_status, reason FROM public.notify_seen WHERE app_id = $1 ORDER BY ctid`, [id(21)])).rows;
check("notifier saw pending -> rejected with job_cancelled first (sends nothing to an unhired applicant)",
  seen[0]?.old_status === "pending" && seen[0]?.new_status === "rejected" && seen[0]?.reason === "job_cancelled", JSON.stringify(seen));
check("the rewrite reaches the notifier only as rejected -> rejected (never a new 'not selected')",
  seen.slice(1).every((r) => r.old_status === "rejected" && r.new_status === "rejected"), JSON.stringify(seen));

// Members cannot read the account list.
if (MODE !== "skip") {
  const acl = (await db.query(`SELECT has_table_privilege('authenticated', 'public.quiet_cancel_posters', 'SELECT') AS a, has_table_privilege('anon', 'public.quiet_cancel_posters', 'SELECT') AS b`)).rows[0];
  check("quiet_cancel_posters: no SELECT for authenticated or anon", !acl.a && !acl.b, JSON.stringify(acl));
} else {
  check("quiet_cancel_posters exists", false, "migration skipped");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
