#!/usr/bin/env node
/**
 * PGlite proof for 20260924013306_messages_receiver_set_null (docs/OPEN.md
 * Q262, receiver half): deleting a RECEIVER's auth row keeps the survivor's
 * message with receiver_id NULL, the survivor's own view of it still loads,
 * the BEFORE UPDATE triggers let the SET NULL through in server context, and
 * a later job status change neither fans a system row out to NULL nor aborts.
 *
 *   node src/test/pglite/messagesReceiverSetNull.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messagesReceiverSetNull.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * is prod-shaped for the columns and triggers involved: messages as live
 * (receiver_id NOT NULL, sender FK CASCADE from 20260924010547 applied
 * verbatim), the live bodies of enforce_message_non_sender_read_only,
 * stamp_message_read_at, enforce_ban_gate and is_server_context, and the
 * PREVIOUS insert_job_status_system_message (20260910 body, measured live
 * 2026-09-24 via pg_get_functiondef). The new migration is applied 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SENDER = "20260924010547_user_fks_prefs_and_message_sender.sql";
const Q262 = "20260924013306_messages_receiver_set_null.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, status public.job_status);
CREATE TABLE public.notification_preferences (id serial, user_id uuid);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  content text, read boolean DEFAULT false, read_at timestamptz, edited_at timestamptz,
  created_at timestamptz DEFAULT now(), is_system boolean DEFAULT false,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  attachment_url text, attachment_mime text, attachment_size int, attachment_duration int,
  flagged_hidden boolean DEFAULT false, client_id uuid, UNIQUE (sender_id, client_id));

-- Live bodies (pg_get_functiondef, 2026-09-24).
CREATE FUNCTION public.enforce_message_non_sender_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF public.is_server_context() THEN RETURN NEW; END IF;
  IF auth.uid() = OLD.sender_id THEN RETURN NEW; END IF;
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'a message may only be edited by the person who sent it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_messages_non_sender_read_only BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_message_non_sender_read_only();
CREATE FUNCTION public.stamp_message_read_at() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
begin
  if public.is_server_context() then return NEW; end if;
  if coalesce(NEW.read, false) and not coalesce(OLD.read, false) then NEW.read_at := now(); else NEW.read_at := OLD.read_at; end if;
  return NEW;
end $f$;
CREATE TRIGGER trg_stamp_message_read_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.stamp_message_read_at();
CREATE FUNCTION public.enforce_ban_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_ban_gate_messages_update BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();

-- The PREVIOUS insert_job_status_system_message (live 2026-09-24).
CREATE FUNCTION public.insert_job_status_system_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_content text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_content := CASE NEW.status::text WHEN 'accepted' THEN 'awarded' WHEN 'in_progress' THEN 'started'
    WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' WHEN 'disputed' THEN 'disputed' ELSE NULL END;
  IF v_content IS NULL THEN RETURN NEW; END IF;
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT NEW.id, NEW.customer_id,
    CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END, v_content, false, true
  FROM messages m WHERE m.job_id = NEW.id AND m.is_system = false AND m.sender_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $f$;
CREATE TRIGGER job_status_system_message AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.insert_job_status_system_message();
`);
await db.exec(mig(SENDER));

const POSTER = "00000000-0000-0000-0000-00000000000a";
const LEAVER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const JOB = "00000000-0000-0000-0000-000000000001";
const JOB2 = "00000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users (id) VALUES ('${POSTER}'), ('${LEAVER}'), ('${OTHER}');
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', 'accepted'), ('${JOB2}', '${LEAVER}', 'accepted');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES
  ('${JOB}', '${POSTER}', '${LEAVER}', 'kept: poster to leaver'),
  ('${JOB}', '${LEAVER}', '${POSTER}', 'gone: leaver to poster'),
  ('${JOB}', '${POSTER}', '${OTHER}', 'untouched: poster to other'),
  ('${JOB2}', '${OTHER}', '${LEAVER}', 'kept: other to leaver on the leaver''s own job');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q262));
}

const one = async (sql) => (await db.query(sql)).rows[0];

// Structure.
const fk = await one(`SELECT confdeltype::text d FROM pg_constraint WHERE conname='messages_receiver_id_fkey'`);
check("messages_receiver_id_fkey exists with ON DELETE SET NULL (confdeltype 'n')", fk?.d === "n", `got ${fk?.d}`);
const nn = await one(`SELECT attnotnull FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='receiver_id'`);
check("receiver_id is nullable", nn.attnotnull === false, `attnotnull=${nn.attnotnull}`);

// The deletion, in server context (GoTrue / service role: no uid, no user role).
let delErr = null;
try {
  await db.exec(`SELECT set_config('test.uid', '', false); SELECT set_config('test.role', 'service_role', false);
    DELETE FROM auth.users WHERE id = '${LEAVER}';`);
} catch (e) { delErr = String(e.message ?? e); }
check("deleting the receiver's auth row succeeds", delErr === null, delErr ?? "");

const kept = await one(`SELECT count(*)::int n FROM public.messages WHERE content LIKE 'kept:%' AND receiver_id IS NULL`);
check("both survivors' messages to the deleted account are kept, receiver_id NULL", kept.n === 2, `n=${kept.n}`);
const gone = await one(`SELECT count(*)::int n FROM public.messages WHERE content LIKE 'gone:%'`);
check("the deleted account's own sent message is gone (sender CASCADE)", gone.n === 0, `n=${gone.n}`);
const untouched = await one(`SELECT receiver_id::text r FROM public.messages WHERE content LIKE 'untouched:%'`);
check("a message to someone else is untouched", untouched.r === OTHER, untouched.r);

// The sender's view still loads: the inbox query and the deleted-thread filter
// (src/lib/deletedCounterparty.ts threadPairFilter) as SQL.
const inbox = await one(`SELECT count(*)::int n FROM public.messages WHERE sender_id='${POSTER}' OR receiver_id='${POSTER}'`);
check("poster's inbox read returns the kept + untouched rows", inbox.n === 2, `n=${inbox.n}`);
const thread = await one(`SELECT count(*)::int n FROM public.messages WHERE job_id='${JOB}'
  AND ((sender_id='${POSTER}' AND receiver_id IS NULL) OR is_system)`);
check("poster's deleted-account thread returns the kept message", thread.n === 1, `n=${thread.n}`);

// A status change after the deletion: no system row addressed to NULL, and an
// ownerless job's transition is not aborted.
let stErr = null;
try {
  await db.exec(`UPDATE public.jobs SET status='completed' WHERE id='${JOB}';`);
} catch (e) { stErr = String(e.message ?? e); }
check("status change on a job with a kept message succeeds", stErr === null, stErr ?? "");
const sysNull = await one(`SELECT count(*)::int n FROM public.messages WHERE is_system AND receiver_id IS NULL`);
check("no system row is addressed to nobody", sysNull.n === 0, `n=${sysNull.n}`);
const sysOther = await one(`SELECT count(*)::int n FROM public.messages WHERE is_system AND receiver_id='${OTHER}'`);
check("the surviving participant still gets the system row", sysOther.n === 1, `n=${sysOther.n}`);
let st2Err = null;
try {
  await db.exec(`UPDATE public.jobs SET status='cancelled' WHERE id='${JOB2}';`);
} catch (e) { st2Err = String(e.message ?? e); }
check("status change on an ownerless job (poster deleted) is not aborted", st2Err === null, st2Err ?? "");

// A user in their own session still cannot rewrite someone else's receiver.
let userErr = null;
try {
  await db.exec(`SELECT set_config('test.uid', '${OTHER}', false); SELECT set_config('test.role', 'authenticated', false);
    UPDATE public.messages SET receiver_id = NULL WHERE content LIKE 'untouched:%';`);
} catch (e) { userErr = String(e.message ?? e); }
check("a non-sender user still cannot null a receiver_id", /only be edited/.test(userErr ?? ""), userErr ?? "no error");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
