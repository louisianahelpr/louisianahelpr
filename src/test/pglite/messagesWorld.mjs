/**
 * A prod-shaped PGlite world for the public.messages proofs of
 * 20261004001242_messages_status_notices_and_sender_writes (Q1169, Q1166,
 * Q1167): messageRateSparesStatusNotices, messageReadReceiptIsTheReceivers,
 * systemNoticesOutliveTheirSender.
 *
 * LIVE STATE, read 2026-10-03 (SELECT-only on prod):
 *   - public.messages: the 18 columns with their NOT NULLs/defaults, the two
 *     CHECKs, the reply_to_id self-FK (ON DELETE SET NULL) and the jobs FK
 *     (ON DELETE CASCADE). The sender/receiver FKs to auth.users are not
 *     modelled (no auth.users here).
 *   - grants: relacl `authenticated=rdxm, anon=rxm` (MAINTAIN not modelled),
 *     authenticated column INSERT on the 10 send columns (Q340) and column
 *     UPDATE on content, edited_at, read.
 *   - the 7 RLS policies, verbatim from pg_policies.
 *   - the triggers, verbatim from pg_get_triggerdef: every row trigger on
 *     messages except messages_scan_consequence(_on_edit) (they fire only WHEN
 *     flagged_hidden, and the scanner here never flags) and the statement-level
 *     zz_refuse_unconfirmed_email_write (a caller gate on email confirmation,
 *     not what these prove); on jobs, job_status_system_message only (the jobs
 *     guard triggers that police who may move a status are not modelled: a
 *     status UPDATE here stands for the RPC that makes it).
 *   - every function those call, VERBATIM from its newest definition before
 *     the migration under test, and md5(prosrc) checked against prod's value
 *     (LIVE_MD5): the fixture is prod's code, or the proof refuses to run.
 * Stubbed, and said so: auth.uid()/auth.role() (the JWT, from
 * request.uid/request.role), has_role (no admins), contact_leak_reason (no
 * message trips the contact scanner), realtime.topic() (the realtime.topic
 * setting).
 *
 * Roles are real: `SET ROLE authenticated` with a uid is a PostgREST request
 * with a user JWT; no uid + service_role is an edge function; the superuser
 * (the table owner, as postgres is on prod, BYPASSRLS) seeds.
 *
 * pglite is not a dependency (CLAUDE.md): PGLITE_DIR (default ~/.lh-pglite).
 */
import os from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
export const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
export const MIGRATION = "20261004001242_messages_status_notices_and_sender_writes.sql";
export const readMigration = (f) => readFileSync(MIG_DIR + f, "utf8");
export const CLIENT_COLUMNS_CHECK = readFileSync(
  fileURLToPath(new URL("../../../scripts/ci/client-insert-columns.sql", import.meta.url)),
  "utf8",
);

/** md5(prosrc) on prod, 2026-10-03, of every function the world loads. */
export const LIVE_MD5 = {
  is_server_context: "ebc78d554c09d9ebf387992e83d584c8",
  are_users_blocked: "a0731c1a984038d3fab1f3b770188e36",
  is_caller_banned: "aa2d685d4bf422d319d8134311feae32",
  job_legacy_completed_at: "c8f0e50498eed1eac1b56401a515c14a",
  job_messaging_closes_at: "400867c9e4d43fab05e647f3f31628bc",
  can_message_in_job: "a73d5db21730ed0041f80c65547cc138",
  is_off_job: "a1047297b9d5922c26d3a100bcf7a1fb",
  can_send_message_in_job: "5c0fdfeb9378f6c2c1254bdb75143109",
  can_send_message_to_in_job: "adde58ba323ddb81f0cb78d59972c7d7",
  enforce_message_rate: "aa9fc92254824c20cb1a434624bbf0c5",
  enforce_block_on_message_insert: "9fbca85d805d91c3dd56f5a2699f0609",
  scan_message_content: "ad8d5da9dd40986559467c5acc17e5d6",
  messages_validate_reply: "4096a1efe0a529160174bab3a2249db9",
  enforce_ban_gate: "660af55c450008e6a4c6abdc57f14062",
  notify_message_recipient: "b7df39b7ec6e80e0672e4ef0d4685411",
  insert_job_status_system_message: "d2e0b47244387473bd586cb602e20841",
  enforce_message_non_sender_read_only: "f1f3ba25dc78c046ca7266bc52c124c2",
  stamp_message_edited_at: "1c9fee37f3145a0f45bd862fb45fc593",
  stamp_message_read_at: "65c8df7b4fafae70608bea95ba671be0",
  mark_message_notifications_read: "3dfebd647552e041a800dcf46ff43a4c",
};
/** md5(prosrc) the migration under test leaves (the done-when values). */
export const NEW_MD5 = {
  enforce_message_rate: "db66ded9018c6ca4af79647c2d632d3e",
  can_send_message_to_in_job: "9fbc0f481c21c33564886b0aef89f304",
  insert_job_status_system_message: "7b9df9c20d46f0dadc1e6489c55b0c14",
  enforce_message_non_sender_read_only: "816df9b5562b573d904422f7f9c8f0bf",
};
// Load order: a SQL body is resolved at CREATE, so a callee comes first.
const LOAD_ORDER = Object.keys(LIVE_MD5);

/**
 * The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in the
 * migrations before MIGRATION, cut at its own closing dollar tag (any tag, also
 * inside an EXECUTE $fn$ … $fn$). A match on a `--` comment line is skipped;
 * the md5 pin catches any other wrong pick.
 */
export function liveFunctionSql(name) {
  let found = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of FILES) {
    if (f >= MIGRATION) break;
    const sql = readMigration(f);
    for (const m of sql.matchAll(head)) {
      const lineStart = sql.lastIndexOf("\n", m.index) + 1;
      if (sql.slice(lineStart, m.index).includes("--")) continue;
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(rest);
      if (!tag) continue;
      const close = rest.indexOf(tag[1], tag.index + tag[0].length);
      if (close < 0) continue;
      found = { file: f, sql: `${rest.slice(0, close + tag[1].length)};` };
    }
  }
  if (!found) throw new Error(`no migration before ${MIGRATION} defines public.${name}`);
  return found;
}

export const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f"; // poster-e2e
export const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5"; // helper-e2e

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
GRANT USAGE ON SCHEMA auth, public, realtime TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), realtime.topic() TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
-- Stubs (see the header).
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.contact_leak_reason(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  status public.job_status NOT NULL DEFAULT 'open',
  completed_at timestamptz, poster_completed_at timestamptz, helper_completed_at timestamptz,
  revision_completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', UNIQUE (job_id, helper_id));
CREATE TABLE public.group_job_helpers (job_id uuid NOT NULL, helper_id uuid);
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE TABLE public.fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, flag_type text, details text, job_id uuid,
  resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text,
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());

-- public.messages as LIVE (information_schema.columns + pg_constraint, 2026-10-03).
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  receiver_id uuid,
  content text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  flagged_hidden boolean NOT NULL DEFAULT false,
  flag_reason text,
  attachment_url text,
  attachment_mime text,
  attachment_size integer,
  attachment_duration integer,
  is_system boolean NOT NULL DEFAULT false,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  read_at timestamptz,
  edited_at timestamptz,
  client_id uuid,
  CONSTRAINT messages_content_length_check CHECK (((content IS NULL) OR (char_length(content) <= 4000))),
  CONSTRAINT messages_not_to_self CHECK ((sender_id <> receiver_id))
);
CREATE UNIQUE INDEX messages_sender_client_id_key ON public.messages USING btree (sender_id, client_id) WHERE (client_id IS NOT NULL);

-- Grants as LIVE (pg_class.relacl, information_schema.column_privileges).
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE, REFERENCES ON public.messages TO authenticated;
GRANT SELECT, REFERENCES ON public.messages TO anon;
GRANT INSERT (client_id, job_id, sender_id, receiver_id, content, attachment_url, attachment_mime,
              attachment_size, attachment_duration, reply_to_id) ON public.messages TO authenticated;
GRANT UPDATE (content, edited_at, read) ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
GRANT SELECT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
`;

// The 7 policies on public.messages, verbatim from pg_policies (2026-10-03).
const POLICIES = `
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can delete their own sent messages" ON public.messages FOR DELETE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = sender_id));
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = sender_id) AND can_send_message_in_job(job_id) AND can_send_message_to_in_job(job_id, receiver_id) AND ((attachment_url IS NULL) OR ((split_part(attachment_url, '/'::text, 1) = (job_id)::text) AND (split_part(attachment_url, '/'::text, 2) = (sender_id)::text) AND (split_part(attachment_url, '/'::text, 3) <> ''::text) AND (split_part(attachment_url, '/'::text, 4) = ''::text)) OR ((split_part(attachment_url, '/'::text, 1) = 'voice-notes'::text) AND (split_part(attachment_url, '/'::text, 2) = (job_id)::text) AND (split_part(attachment_url, '/'::text, 3) = (sender_id)::text) AND (split_part(attachment_url, '/'::text, 4) <> ''::text) AND (split_part(attachment_url, '/'::text, 5) = ''::text)))));
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Users can subscribe to own channels" ON public.messages FOR SELECT TO authenticated
  USING (((realtime.topic() ~ ('^(notifications|messages):'::text || (( SELECT auth.uid() AS uid))::text)) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM jobs
  WHERE (((realtime.topic() ~ ('^jobs:'::text || (jobs.id)::text)) OR (realtime.topic() ~ ('^job_tracking:'::text || (jobs.id)::text)) OR (realtime.topic() ~ ('^job_checkins:'::text || (jobs.id)::text))) AND ((jobs.customer_id = ( SELECT auth.uid() AS uid)) OR (jobs.helper_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = sender_id) OR ((( SELECT auth.uid() AS uid) = receiver_id) AND (COALESCE(flagged_hidden, false) = false))));
CREATE POLICY "Users can edit their own sent messages" ON public.messages FOR UPDATE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = sender_id) AND (is_system = false) AND (created_at > (now() - '00:15:00'::interval))))
  WITH CHECK (((( SELECT auth.uid() AS uid) = sender_id) AND (is_system = false)));
CREATE POLICY "Users can mark messages as read" ON public.messages FOR UPDATE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = receiver_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = receiver_id));
`;

// Function grants as LIVE (pg_proc.proacl): the two gate wrappers are
// authenticated-callable; is_server_context is callable by every client role;
// the trigger functions are not EXECUTE-able by PUBLIC/anon/authenticated.
const FUNCTION_GRANTS = `
REVOKE ALL ON FUNCTION public.can_send_message_in_job(uuid), public.can_send_message_to_in_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_message_in_job(uuid), public.can_send_message_to_in_job(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_message_rate(), public.enforce_block_on_message_insert(), public.scan_message_content(),
  public.messages_validate_reply(), public.enforce_ban_gate(), public.notify_message_recipient(),
  public.insert_job_status_system_message(), public.enforce_message_non_sender_read_only(),
  public.stamp_message_edited_at(), public.stamp_message_read_at(), public.mark_message_notifications_read()
  FROM PUBLIC, anon, authenticated;
`;

// Triggers, verbatim from pg_get_triggerdef (2026-10-03).
const TRIGGERS = `
CREATE TRIGGER enforce_message_rate BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_message_rate();
CREATE TRIGGER messages_scan_content BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION scan_message_content();
CREATE TRIGGER messages_validate_reply_trg BEFORE INSERT OR UPDATE OF reply_to_id ON public.messages FOR EACH ROW EXECUTE FUNCTION messages_validate_reply();
CREATE TRIGGER notify_message_recipient_tg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_message_recipient();
CREATE TRIGGER scan_message_on_edit BEFORE UPDATE OF content ON public.messages FOR EACH ROW WHEN ((old.content IS DISTINCT FROM new.content)) EXECUTE FUNCTION scan_message_content();
CREATE TRIGGER trg_ban_gate_messages BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_ban_gate();
CREATE TRIGGER trg_ban_gate_messages_delete BEFORE DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_ban_gate();
CREATE TRIGGER trg_ban_gate_messages_update BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_ban_gate();
CREATE TRIGGER trg_enforce_block_on_message_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_block_on_message_insert();
CREATE TRIGGER trg_mark_message_notifications_read AFTER UPDATE OF read ON public.messages FOR EACH ROW WHEN ((new.read AND (NOT old.read))) EXECUTE FUNCTION mark_message_notifications_read();
CREATE TRIGGER trg_messages_non_sender_read_only BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_message_non_sender_read_only();
CREATE TRIGGER trg_stamp_message_edited_at BEFORE UPDATE OF content ON public.messages FOR EACH ROW EXECUTE FUNCTION stamp_message_edited_at();
CREATE TRIGGER trg_stamp_message_read_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION stamp_message_read_at();
CREATE TRIGGER job_status_system_message AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION insert_job_status_system_message();
`;

/**
 * Build the world. `skip` (NEW_MIGRATION=skip) leaves prod's state; otherwise
 * the migration under test runs verbatim three times on top (replay safety).
 */
export async function messagesWorld({ skip }) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  const loaded = [];
  for (const name of LOAD_ORDER) {
    const d = liveFunctionSql(name);
    await db.exec(d.sql);
    loaded.push(`${name}@${d.file.slice(0, 14)}`);
  }
  const md5s = Object.fromEntries(
    (await db.query(`SELECT proname, md5(prosrc) AS md5 FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).rows.map((r) => [r.proname, r.md5]),
  );
  const off = LOAD_ORDER.filter((n) => md5s[n] !== LIVE_MD5[n]);
  if (off.length) throw new Error(`the fixture is not prod's code: md5(prosrc) differs for ${off.join(", ")}`);
  await db.exec(FUNCTION_GRANTS + POLICIES + TRIGGERS);
  // MIGRATION_SQL_FILE: run another version of the migration instead (e.g. a
  // previous commit's, `git show <sha>:<path>`), to show a check red on it.
  const sql = process.env.MIGRATION_SQL_FILE ? readFileSync(process.env.MIGRATION_SQL_FILE, "utf8") : readMigration(MIGRATION);
  if (!skip) for (let i = 0; i < 3; i++) await db.exec(sql);
  return { db, loaded };
}

/** Run `sql` as a caller: a user uid (authenticated), "service" (edge function) or null (anon). */
export async function as(db, who, sql) {
  const uid = who && who !== "service" ? who : "";
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid}', false), set_config('request.role', '${role}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try {
    const r = await db.query(sql);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, err: e.message };
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.uid', '', false), set_config('request.role', '', false);");
  }
}

/** Seed rows as the table owner with every trigger off (setup, not under test). */
export async function seed(db, sql) {
  await db.exec(`RESET ROLE; SET session_replication_role = replica; ${sql}; SET session_replication_role = origin;`);
}

export function checker() {
  let failures = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };
  return { check, done: () => { console.log(failures ? `${failures} FAILED` : "ALL PASS"); process.exit(failures ? 1 : 0); } };
}
