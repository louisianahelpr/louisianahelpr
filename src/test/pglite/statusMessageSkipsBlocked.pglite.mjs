#!/usr/bin/env node
/**
 * PGlite proof for 20261003183349_status_message_skips_blocked_participants (Q713).
 *
 *   node src/test/pglite/statusMessageSkipsBlocked.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/statusMessageSkipsBlocked.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE bodies (pg_get_functiondef, 2026-10-03) of
 * public.is_server_context, public.are_users_blocked,
 * public.enforce_block_on_message_insert (BEFORE INSERT ON messages) and
 * public.insert_job_status_system_message (AFTER UPDATE OF status ON jobs,
 * SECURITY DEFINER), on a jobs/messages/user_blocks shape trimmed to the
 * columns they read. Roles are real: `SET ROLE authenticated` with a uid is a
 * PostgREST request with a user JWT; no uid + service_role is an edge
 * function. auth.uid()/auth.role() read request.uid/request.role.
 *
 * The migration is applied 3x, then:
 *   - a status change on a job whose thread holds a participant blocked with
 *     the poster (either direction) SUCCEEDS, by the poster or by the Helpr,
 *     and sends that participant no message while everyone else gets one;
 *   - with no block, every participant still gets the message;
 *   - the service role's status change behaves the same;
 *   - the block trigger still refuses a person messaging someone blocked.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261003183349_status_message_skips_blocked_participants.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const BLOCKED = "33333333-3333-4333-8333-333333333333"; // an applicant in the thread, blocked with the poster
const OTHER = "44444444-4444-4444-8444-444444444444"; // an applicant in the thread, no block
const J1 = "10000000-0000-4000-8000-000000000001"; // poster blocked BLOCKED
const J2 = "10000000-0000-4000-8000-000000000002"; // BLOCKED blocked the poster (other direction)
const J3 = "10000000-0000-4000-8000-000000000003"; // no block in the thread
const J4 = "10000000-0000-4000-8000-000000000004"; // service-role change, poster blocked BLOCKED
const J5 = "10000000-0000-4000-8000-000000000005"; // the Helpr makes the change

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status);
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL, sender_id uuid NOT NULL, receiver_id uuid, content text NOT NULL,
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  is_system boolean NOT NULL DEFAULT false, client_id uuid,
  CONSTRAINT messages_sender_client_id_key UNIQUE (sender_id, client_id)
);
GRANT SELECT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs, public.messages, public.user_blocks TO service_role;
GRANT SELECT, INSERT ON public.messages TO authenticated;

-- LIVE public.is_server_context()
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

-- LIVE public.are_users_blocked(uuid, uuid)
CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false)
      OR public.is_server_context()
      OR pg_trigger_depth() > 0
    THEN EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    )
  END;
$function$;
GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_server_context() TO anon, authenticated, service_role;

-- LIVE public.enforce_block_on_message_insert()
CREATE OR REPLACE FUNCTION public.enforce_block_on_message_insert()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  -- Server contexts only; an anon write (NULL uid, role anon) is checked.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  IF public.are_users_blocked(NEW.sender_id, NEW.receiver_id) THEN
    RAISE EXCEPTION 'You can''t message this user.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_enforce_block_on_message_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_message_insert();

-- LIVE public.insert_job_status_system_message() (last defined by 20260924013306)
CREATE OR REPLACE FUNCTION public.insert_job_status_system_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  v_content := CASE NEW.status::text
    WHEN 'accepted'    THEN '✓ Job awarded'
    WHEN 'in_progress' THEN '▶ Work started'
    WHEN 'completed'   THEN '✓ Job completed'
    WHEN 'cancelled'   THEN '✕ Job cancelled'
    WHEN 'disputed'    THEN '⚠ Dispute opened'
    ELSE NULL
  END;
  IF v_content IS NULL THEN RETURN NEW; END IF;
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NEW.customer_id,
    p.participant,
    v_content,
    false,
    true
  FROM (
    SELECT CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END AS participant
    FROM messages m
    WHERE m.job_id = NEW.id
      AND m.is_system = false
      AND m.sender_id IS NOT NULL
  ) p
  WHERE p.participant IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER job_status_system_message AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.insert_job_status_system_message();

INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES
  ('${J1}', '${POSTER}', '${HELPER}', 'in_progress'),
  ('${J2}', '${POSTER}', '${HELPER}', 'in_progress'),
  ('${J3}', '${POSTER}', '${HELPER}', 'in_progress'),
  ('${J4}', '${POSTER}', '${HELPER}', 'in_progress'),
  ('${J5}', '${POSTER}', '${HELPER}', 'in_progress');
-- Each thread: the Helpr, a blocked applicant and an unblocked one wrote to the poster (before the block).
INSERT INTO public.messages (job_id, sender_id, receiver_id, content)
SELECT j, s, '${POSTER}', 'hello' FROM unnest(ARRAY['${J1}','${J2}','${J3}','${J4}','${J5}']::uuid[]) j
  CROSS JOIN unnest(ARRAY['${HELPER}','${BLOCKED}','${OTHER}']::uuid[]) s;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${POSTER}', '${BLOCKED}');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  const uid = who && who !== "service" ? who : "";
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid}', false), set_config('request.role', '${role}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const sysTo = async (job) =>
  (await db.query(`SELECT receiver_id::text AS r FROM public.messages WHERE job_id = '${job}' AND is_system ORDER BY 1`)).rows.map((x) => x.r);
const statusOf = async (job) => (await db.query(`SELECT status::text AS s FROM public.jobs WHERE id = '${job}'`)).rows[0].s;

async function change(label, who, job, to, { expectTo }) {
  const r = await as(who, `UPDATE public.jobs SET status = '${to}' WHERE id = '${job}' RETURNING id`);
  const s = await statusOf(job);
  const got = await sysTo(job);
  const ok = r.ok && r.rows.length === 1 && s === to && JSON.stringify(got) === JSON.stringify([...expectTo].sort());
  check(label, ok, r.ok ? `status=${s}; system messages to ${JSON.stringify(got)}` : r.err);
}

// ── RED on live: one blocked participant aborts the whole status change ─────
await change("R1 poster completes a job whose thread holds an applicant the poster blocked", POSTER, J1, "completed", { expectTo: [HELPER, OTHER] });
await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BLOCKED}', '${POSTER}');`);
await change("R2 ...and when the participant blocked the poster (other direction)", POSTER, J2, "cancelled", { expectTo: [HELPER, OTHER] });
await change("R3 the Helpr's own move (dispute) on such a job", HELPER, J5, "disputed", { expectTo: [HELPER, OTHER] });

// ── Unchanged behaviour ─────────────────────────────────────────────────────
await db.exec(`DELETE FROM public.user_blocks;`);
await change("L1 no block: every participant gets the status message", POSTER, J3, "completed", { expectTo: [HELPER, BLOCKED, OTHER] });
await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${POSTER}', '${BLOCKED}');`);
await change("L2 the service role's status change skips the blocked participant too", "service", J4, "cancelled", { expectTo: [HELPER, OTHER] });
{
  const r = await as(POSTER, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J3}', '${POSTER}', '${BLOCKED}', 'hey') RETURNING id`);
  check("L3 the block trigger still refuses the poster messaging the blocked person", !r.ok && /can't message this user/.test(r.err), r.ok ? "landed" : r.err);
}

// ── The function itself ─────────────────────────────────────────────────────
if (MODE !== "skip") {
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.insert_job_status_system_message()')`)).rows[0];
  check("F1 still SECURITY DEFINER, not EXECUTE-able by PUBLIC/anon/authenticated", f && f.prosecdef === true && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl ?? "{=X}"), JSON.stringify(f));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
