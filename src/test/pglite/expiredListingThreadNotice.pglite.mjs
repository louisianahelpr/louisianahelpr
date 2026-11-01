#!/usr/bin/env node
/**
 * PGlite proof for 20261101011526_expired_listing_thread_notice_not_cancelled (owner 10-31, B44).
 *
 *   node src/test/pglite/expiredListingThreadNotice.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/expiredListingThreadNotice.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite (override with PGLITE_DIR).
 *
 * Fixture = the LIVE body of public.insert_job_status_system_message, read from its newest definition
 * (20261017205845; md5(prosrc) on prod 2026-10-31 = 1d9a48d227f41ecc79a87d17fea415c1 = that file's body), on a
 * jobs/messages shape trimmed to the columns it reads; are_users_blocked is a no-block stub (not under test).
 *
 * The migration is applied 3x, then, as the service role (auto-expire-jobs is an edge function):
 *   - an expired listing (no Helpr, no cancelled_by, the sweep's reason) writes "✕ No longer open" to the applicant,
 *     never "✕ Job cancelled";
 *   - a poster's cancellation (cancelled_by set) still writes "✕ Job cancelled", even when the poster typed the
 *     sweep's reason; a hired job that is cancelled still does too;
 *   - other moves are unchanged ("▶ Work started").
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261101011526_expired_listing_thread_notice_not_cancelled.sql");
const LIVE_SRC = read("../../../supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql");
const start = LIVE_SRC.indexOf("CREATE OR REPLACE FUNCTION public.insert_job_status_system_message()");
const LIVE = LIVE_SRC.slice(start, LIVE_SRC.indexOf("$function$;", start) + "$function$;".length);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const APPLICANT = "33333333-3333-4333-8333-333333333333";
const SWEEP = "Job listing expired — scheduled time passed with no Helpr assigned"; // auto-expire-jobs/index.ts
const J = (n) => `10000000-0000-4000-8000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status,
  cancelled_by uuid, cancellation_reason text, cancelled_at timestamptz);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL, sender_id uuid NOT NULL, receiver_id uuid, content text NOT NULL,
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  is_system boolean NOT NULL DEFAULT false
);
GRANT ALL ON public.jobs, public.messages TO service_role;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
${LIVE}
CREATE TRIGGER job_status_system_message AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.insert_job_status_system_message();
INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES
  ('${J(1)}', '${POSTER}', NULL, 'open'),
  ('${J(2)}', '${POSTER}', NULL, 'open'),
  ('${J(3)}', '${POSTER}', NULL, 'open'),
  ('${J(4)}', '${POSTER}', '${HELPER}', 'accepted'),
  ('${J(5)}', '${POSTER}', '${HELPER}', 'accepted');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content)
SELECT j, '${APPLICANT}', '${POSTER}', 'Is this still open?' FROM unnest(ARRAY['${J(1)}','${J(2)}','${J(3)}','${J(4)}','${J(5)}']::uuid[]) j;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function move(job, set) {
  await db.exec("SET ROLE service_role");
  try { await db.exec(`UPDATE public.jobs SET ${set} WHERE id = '${job}'`); } finally { await db.exec("RESET ROLE"); }
  return (await db.query(`SELECT content, receiver_id::text AS r FROM public.messages WHERE job_id = '${job}' AND is_system`)).rows;
}
const say = (rows) => JSON.stringify(rows.map((r) => r.content));

let rows = await move(J(1), `status = 'cancelled', cancelled_at = now(), cancellation_reason = '${SWEEP}'`);
check("expired listing: the applicant reads '✕ No longer open', never Cancelled",
  rows.length === 1 && rows[0].content === "✕ No longer open" && rows[0].r === APPLICANT, say(rows));

rows = await move(J(2), `status = 'cancelled', cancelled_at = now(), cancelled_by = '${POSTER}', cancellation_reason = 'Plans changed'`);
check("poster's cancellation still reads '✕ Job cancelled'", rows.length === 1 && rows[0].content === "✕ Job cancelled", say(rows));

rows = await move(J(3), `status = 'cancelled', cancelled_at = now(), cancelled_by = '${POSTER}', cancellation_reason = '${SWEEP}'`);
check("a poster who TYPES the sweep's reason is still a cancellation", rows.length === 1 && rows[0].content === "✕ Job cancelled", say(rows));

rows = await move(J(4), `status = 'cancelled', cancelled_at = now(), cancellation_reason = '${SWEEP}'`);
check("a hired job cancelled with no cancelled_by is not an expired listing", rows.length === 1 && rows[0].content === "✕ Job cancelled", say(rows));

rows = await move(J(5), `status = 'in_progress'`);
check("other moves unchanged", rows.length === 1 && rows[0].content === "▶ Work started", say(rows));

const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'insert_job_status_system_message'`)).rows[0].a ?? "";
check("no EXECUTE for PUBLIC, anon or authenticated", !/(^|[{,])=X|anon=|authenticated=/.test(acl), acl);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
